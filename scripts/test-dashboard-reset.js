const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const AdminResetService = require('../services/adminResetService');
const AdminStatsService = require('../services/adminStatsService');
const Order = require('../models/Order');
const User = require('../models/User');
const Design = require('../models/Design');

async function runTestSuite() {
  console.log('====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE DASHBOARD RESET TEST SUITE');
  console.log('====================================================');

  await db.initPool();

  const [adminUser] = await db.query("SELECT id, email, password_hash, role FROM users WHERE role = 'admin' LIMIT 1");
  if (!adminUser) {
    throw new Error('Admin user not found in database for testing.');
  }

  // Known admin password in development environment
  // Let's create a known temporary bcrypt password hash or check password
  const testPassword = 'AdminPassword123!';
  const tempHash = await bcrypt.hash(testPassword, 10);
  const originalHash = adminUser.password_hash;

  // Temporarily set known password hash for testing auth verification
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [tempHash, adminUser.id]);
  adminUser.password_hash = tempHash;

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // -----------------------------------------------------------------
    // TEST 1: Live Counts
    // -----------------------------------------------------------------
    console.log('\n--- 1. Testing Live Counts API ---');
    const counts = await AdminResetService.getLiveCounts();
    assert(counts && typeof counts.orders.total === 'number', 'Live counts returned valid orders count');
    assert(counts.customers.adminCount >= 1, `Admins correctly identified (${counts.customers.adminCount} admin(s))`);
    assert(typeof counts.demoDesigns === 'number', 'Demo designs count returned');
    assert(counts.dangerAllDesigns >= 100, `Real catalog designs counted (${counts.dangerAllDesigns} designs)`);

    // -----------------------------------------------------------------
    // TEST 2: Safety Blocks & Validations
    // -----------------------------------------------------------------
    console.log('\n--- 2. Testing Safety Blocks & Password Verification ---');

    // 2a. Wrong password
    try {
      await AdminResetService.executeReset({
        password: 'wrong_password_123',
        confirmResetText: 'RESET',
        confirmUnderstand: true
      }, adminUser);
      assert(false, 'Should have blocked execution on wrong password');
    } catch (err) {
      assert(err.message.includes('Incorrect admin password'), 'Blocked wrong password execution');
    }

    // 2b. Missing RESET text
    try {
      await AdminResetService.executeReset({
        password: testPassword,
        confirmResetText: 'DELETE',
        confirmUnderstand: true
      }, adminUser);
      assert(false, 'Should have blocked execution on invalid confirmation text');
    } catch (err) {
      assert(err.message.includes('Confirmation text mismatch'), 'Blocked execution when RESET text missing');
    }

    // 2c. Missing understand checkbox
    try {
      await AdminResetService.executeReset({
        password: testPassword,
        confirmResetText: 'RESET',
        confirmUnderstand: false
      }, adminUser);
      assert(false, 'Should have blocked execution when checkbox unticked');
    } catch (err) {
      assert(err.message.includes('understand this action cannot be undone'), 'Blocked execution when checkbox unticked');
    }

    // 2d. Real paid order protection
    try {
      await AdminResetService.executeReset({
        password: testPassword,
        confirmResetText: 'RESET',
        confirmUnderstand: true,
        ordersScope: 'all',
        deleteRealPaidOrders: false
      }, adminUser);
      assert(false, 'Should have blocked deleting all orders without explicit deleteRealPaidOrders flag');
    } catch (err) {
      assert(err.message.includes('real paid order') || err.message.includes('explicitly tick'), 'Protected live paid orders from accidental deletion');
    }

    // -----------------------------------------------------------------
    // TEST 3: Pre-Reset Backup Generation
    // -----------------------------------------------------------------
    console.log('\n--- 3. Testing Pre-Reset Backup Creation ---');
    const backup = await AdminResetService.createPreResetBackup(['orders', 'users', 'designs']);
    assert(backup && backup.filename && backup.filename.endsWith('.sql'), `Pre-reset SQL backup generated: ${backup.filename}`);
    assert(backup && backup.csvFilename && backup.csvFilename.endsWith('.csv'), `Pre-reset CSV backup generated: ${backup.csvFilename}`);

    const sqlPath = path.join(__dirname, '..', 'storage_private', 'backups', backup.filename);
    assert(fs.existsSync(sqlPath), 'Backup SQL file exists in storage_private/backups');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    assert(sqlContent.includes('CREATE TABLE') && sqlContent.includes('INSERT INTO'), 'Backup contains DDL and DML data');

    // -----------------------------------------------------------------
    // TEST 4: Seed Test Order & Customer, then Execute Selective Reset
    // -----------------------------------------------------------------
    console.log('\n--- 4. Testing Selective Reset Execution ---');

    // Create a demo customer
    const demoEmail = `test_dummy_${Date.now()}@example.com`;
    const custRes = await db.query(
      "INSERT INTO users (full_name, email, password_hash, role, is_demo, is_active) VALUES ('Demo Customer', ?, 'dummy_hash', 'customer', 1, 1)",
      [demoEmail]
    );
    const demoCustId = custRes.insertId;

    // Create a test order
    const testOrderRes = await db.query(
      `INSERT INTO orders (order_number, user_id, guest_email, guest_name, total_amount, discount_amount, final_amount, status, razorpay_order_id, is_test)
       VALUES (?, ?, ?, 'Demo Customer', 199.00, 0, 199.00, 'pending', 'order_test_unit_999', 1)`,
      [`AE-UNIT-${Date.now()}`, demoCustId, demoEmail]
    );
    const testOrderId = testOrderRes.insertId;

    // Create an order item for the test order
    const [firstDesign] = await db.query('SELECT id FROM designs LIMIT 1');
    if (firstDesign) {
      await db.query(
        'INSERT INTO order_items (order_id, design_id, price_at_purchase) VALUES (?, ?, 199.00)',
        [testOrderId, firstDesign.id]
      );
    }

    // Also create a demo design flagged is_demo = 1
    const demoSlug = `demo-design-${Date.now()}`;
    const demoDesRes = await db.query(
      "INSERT INTO designs (title, slug, price, is_active, is_demo) VALUES ('Demo Seed Design', ?, 99.00, 1, 1)",
      [demoSlug]
    );
    const demoDesignId = demoDesRes.insertId;

    // Execute Selective Reset: test_mode orders, test customers, demo designs
    const resetResult = await AdminResetService.executeReset({
      password: testPassword,
      confirmResetText: 'RESET',
      confirmUnderstand: true,
      ordersScope: 'test_mode',
      clearCustomers: true,
      clearOperational: false,
      clearStats: false,
      clearDemoDesigns: true,
      deleteRealPaidOrders: false
    }, adminUser);

    assert(resetResult.success === true, 'Selective reset returned success');
    assert(resetResult.summaryCounts.orders >= 1, `Removed test orders (${resetResult.summaryCounts.orders} order(s))`);
    assert(resetResult.summaryCounts.customers >= 1, `Removed test customers (${resetResult.summaryCounts.customers} customer(s))`);
    assert(resetResult.summaryCounts.demoDesigns >= 1, `Removed demo designs (${resetResult.summaryCounts.demoDesigns} design(s))`);

    // Verify test records were removed
    const [checkTestOrd] = await db.query('SELECT id FROM orders WHERE id = ?', [testOrderId]);
    assert(!checkTestOrd, 'Test order was deleted');

    const [checkDemoCust] = await db.query('SELECT id FROM users WHERE id = ?', [demoCustId]);
    assert(!checkDemoCust, 'Demo customer was deleted');

    const [checkDemoDes] = await db.query('SELECT id FROM designs WHERE id = ?', [demoDesignId]);
    assert(!checkDemoDes, 'Demo design was deleted');

    // CRITICAL: Verify Real Data is Intact
    const [adminCheck] = await db.query('SELECT id, email, role FROM users WHERE id = ?', [adminUser.id]);
    assert(adminCheck && adminCheck.role === 'admin', 'Super admin account was preserved and protected');

    const [designCountCheck] = await db.query('SELECT COUNT(*) as cnt FROM designs WHERE deleted_at IS NULL');
    assert(Number(designCountCheck.cnt) >= 100, `Real designs preserved (${designCountCheck.cnt} designs intact)`);

    const [catCountCheck] = await db.query('SELECT COUNT(*) as cnt FROM categories');
    assert(Number(catCountCheck.cnt) >= 1, `Product categories preserved (${catCountCheck.cnt} categories)`);

    // -----------------------------------------------------------------
    // TEST 5: Dashboard Stats & Empty States
    // -----------------------------------------------------------------
    console.log('\n--- 5. Testing Dashboard Stats and Correct Real Data ---');
    const statsReal = await AdminStatsService.getDashboardStats({ includeTestData: false });
    assert(statsReal.designsBreakdown && statsReal.designsBreakdown.total >= 100, `Product breakdown calculated: ${statsReal.designsBreakdown.total} total (${statsReal.designsBreakdown.active} active, ${statsReal.designsBreakdown.inactive} inactive)`);
    assert(statsReal.ordersTrend.text !== '+100%', 'Fake +100% trend badge eliminated');
    assert(statsReal.salesTrend.text !== '+100%', 'Fake +100% sales trend badge eliminated');
    assert(statsReal.includeTestData === false, 'Dashboard default excludes test data');

    // -----------------------------------------------------------------
    // TEST 6: Storefront Integrity
    // -----------------------------------------------------------------
    console.log('\n--- 6. Verifying Customer Storefront Data Integrity ---');
    const { designs: catalogDesigns } = await Design.getAll({ limit: 10 });
    assert(Array.isArray(catalogDesigns) && catalogDesigns.length > 0, `Customer storefront designs query succeeded (${catalogDesigns.length} designs retrieved)`);

    // -----------------------------------------------------------------
    // TEST 7: Migration Idempotency
    // -----------------------------------------------------------------
    console.log('\n--- 7. Verifying Migration Idempotency ---');
    const migrationRunner = require('./migrate');
    await migrationRunner({ silent: true });
    assert(true, 'Running migration runner consecutively passed without unknown column or table errors');

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
    console.log('====================================================');
  } finally {
    // Restore original admin password hash
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [originalHash, adminUser.id]);
    console.log('🔒 Admin account original password hash restored.');
  }

  process.exit(0);
}

runTestSuite().catch(err => {
  console.error('\n❌ Test Suite Aborted with Error:', err);
  process.exit(1);
});
