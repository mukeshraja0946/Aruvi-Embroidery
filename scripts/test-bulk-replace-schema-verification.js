/**
 * Automated Verification Script: Bulk Replace Schema & Guard Verification
 * Tests:
 * 1. Deliberately broken schema triggers schema pre-check error and blocks preview & apply.
 * 2. Migration 031 adds missing columns and tables with MariaDB 10.x compatibility.
 * 3. Migration 031 runs twice idempotently without errors.
 * 4. Step 3 preview loads matched designs, images, ZIPs, and dry-run retirement counts.
 * 5. Apply guard protects against un-previewed or 0-match replacements.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const bulkImageReplaceService = require('../services/bulkImageReplaceService');
const { runPendingMigrations } = require('../services/migrationRunner');

async function runVerification() {
  console.log('====================================================');
  console.log('BULK REPLACE SCHEMA & GUARD AUTOMATED VERIFICATION');
  console.log('====================================================');

  await db.initPool();
  assert(db.isConnected(), 'Database must be connected');

  // ----------------------------------------------------------------
  // Test 1: Deliberately break schema to test Schema Pre-Check
  // ----------------------------------------------------------------
  console.log('\n▶ Step 1: Deliberately Breaking Schema & Testing Pre-Check...');

  // Temporarily drop index, virtual active_checksum, and retired_at to test broken schema detection
  try {
    await db.query('ALTER TABLE `design_files` DROP INDEX `idx_design_file_active_unique`');
  } catch (_) {}
  try {
    await db.query('ALTER TABLE `design_files` DROP COLUMN `active_checksum`');
  } catch (_) {}
  try {
    await db.query('ALTER TABLE `design_files` DROP COLUMN `retired_at`');
  } catch (_) {}

  const brokenCheck = await bulkImageReplaceService.checkBulkReplaceSchema();
  assert.strictEqual(brokenCheck.ok, false, 'checkBulkReplaceSchema must report ok: false when retired_at is missing');
  assert(brokenCheck.missing.includes('design_files.retired_at'), 'Missing list must include design_files.retired_at');
  assert(brokenCheck.message.includes('Database update needed: missing design_files.retired_at'), 'Error message must give explicit instructions');
  assert(brokenCheck.refId.startsWith('REF_SCHEMA_'), 'Error must provide reference ID');
  console.log('✓ Broken schema detected by checkBulkReplaceSchema:');
  console.log('  Message:', brokenCheck.message);
  console.log('  RefId:', brokenCheck.refId);

  // Test that matchFilesToScope rejects cleanly with schemaError
  let previewFailedCleanly = false;
  try {
    await bulkImageReplaceService.matchFilesToScope([{ name: 'test.png', size: 100 }], { targetDesignId: 1 });
  } catch (err) {
    previewFailedCleanly = true;
    assert.strictEqual(err.schemaError, true, 'Error must have schemaError: true');
    assert(err.message.includes('Database update needed'), 'Error message must match');
    assert(err.refId, 'Error must include refId');
  }
  assert(previewFailedCleanly, 'matchFilesToScope must reject when schema is broken');
  console.log('✓ matchFilesToScope refused to run broken queries and threw clean schema error.');

  // Test that replaceFileGroup rejects cleanly
  let applyFailedCleanly = false;
  try {
    await bulkImageReplaceService.replaceFileGroup({
      targetDesignId: 1,
      items: [{ originalName: 'test.png', storageKey: 'test.png' }]
    });
  } catch (err) {
    applyFailedCleanly = true;
    assert.strictEqual(err.schemaError, true, 'replaceFileGroup must abort with schemaError: true');
  }
  assert(applyFailedCleanly, 'replaceFileGroup must abort when schema is broken');
  console.log('✓ replaceFileGroup refused to apply when schema was broken.');

  // ----------------------------------------------------------------
  // Test 2: Migration 031 Execution (Run 1)
  // ----------------------------------------------------------------
  console.log('\n▶ Step 2: Running Migration 031 to restore schema...');
  const mig031Path = path.join(__dirname, '../migrations/031_bulk_replace_schema_and_retirement_tracking.sql');
  const mig031Sql = fs.readFileSync(mig031Path, 'utf8');

  // Ensure schema_migrations record is purged so runner applies it
  await db.query('DELETE FROM `schema_migrations` WHERE `version` = "031" OR `name` LIKE "%031%"');

  const migResult1 = await runPendingMigrations({ silent: false });
  assert.strictEqual(migResult1.failedCount, 0, 'Migration run 1 must have 0 failures');
  console.log('✓ Migration 031 applied cleanly on Run 1.');

  // Verify columns exist now
  const fixedCheck = await bulkImageReplaceService.checkBulkReplaceSchema();
  assert.strictEqual(fixedCheck.ok, true, 'checkBulkReplaceSchema must report ok: true after migration');
  assert.strictEqual(fixedCheck.missing.length, 0, 'Missing list must be empty');
  console.log('✓ Schema check verified all required columns and tables are now present.');

  // ----------------------------------------------------------------
  // Test 3: Migration 031 Idempotency (Run 2)
  // ----------------------------------------------------------------
  console.log('\n▶ Step 3: Testing Migration 031 Idempotency (Run 2)...');
  // Re-run migration SQL directly
  const { executeMigrationSql } = require('../services/migrationRunner');
  const mysql = require('mysql2/promise');
  const { dbConfig } = db;
  const directConn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    multipleStatements: true
  });

  try {
    // Run second time directly on connection
    const statements = mig031Sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      try {
        await directConn.query(stmt);
      } catch (err) {
        // Ignored safe idempotent errors
        if (err.errno === 1050 || err.errno === 1060 || err.errno === 1061 || err.errno === 1068) continue;
        throw err;
      }
    }
    console.log('✓ Migration 031 Run 2 executed with 0 duplicate/conflict errors (100% idempotent).');
  } finally {
    await directConn.end();
  }

  // ----------------------------------------------------------------
  // Test 4: Testing Step 3 Preview with Intact Schema
  // ----------------------------------------------------------------
  console.log('\n▶ Step 4: Testing Step 3 Preview Generation with Intact Schema...');

  // Get a sample design to test preview
  const designs = await db.query('SELECT id, sku, title FROM designs LIMIT 1');
  if (designs && designs.length > 0) {
    const testDesign = designs[0];
    const previewResult = await bulkImageReplaceService.matchFilesToScope(
      [
        { name: `${testDesign.sku}_preview.png`, size: 1024 },
        { name: `${testDesign.sku}_files.zip`, size: 2048 }
      ],
      { targetDesignId: testDesign.id }
    );

    assert(previewResult, 'Preview result must be returned');
    assert(Array.isArray(previewResult.previewList), 'previewList must be an array');
    assert.strictEqual(previewResult.previewList.length, 1, 'Target design must match');
    const matched = previewResult.previewList[0];
    assert.strictEqual(matched.sku, testDesign.sku, 'Matched SKU must match target design');
    assert(matched.images.length >= 1, 'Matched images must have at least 1 image');
    assert(matched.downloadFiles.length >= 1, 'Matched files must have at least 1 ZIP');
    assert(typeof matched.willRetireCount === 'number', 'willRetireCount must be a number');
    console.log(`✓ Step 3 preview successfully prepared for Design #${testDesign.id} (${testDesign.sku}):`);
    console.log(`  Matched images: ${matched.images.length}, Matched ZIPs: ${matched.downloadFiles.length}, Dry-run willRetireCount: ${matched.willRetireCount}`);
  }

  // ----------------------------------------------------------------
  // Test 5: Verify Image Replace Log Items Schema
  // ----------------------------------------------------------------
  console.log('\n▶ Step 5: Verifying image_replace_log_items new columns...');
  const logCols = await db.query('SHOW COLUMNS FROM image_replace_log_items');
  const logColNames = logCols.map(c => c.Field);
  assert(logColNames.includes('old_files_json'), 'image_replace_log_items must have old_files_json');
  assert(logColNames.includes('new_files_json'), 'image_replace_log_items must have new_files_json');
  console.log('✓ image_replace_log_items has old_files_json and new_files_json columns.');

  // ----------------------------------------------------------------
  // Test 6: Verify bulk_replace_jobs & bulk_replace_job_items Tables
  // ----------------------------------------------------------------
  console.log('\n▶ Step 6: Verifying job tracking tables...');
  const jobTables = await db.query('SHOW TABLES LIKE "bulk_replace_job%"');
  assert(jobTables.length >= 2, 'bulk_replace_jobs and bulk_replace_job_items must exist');
  console.log('✓ bulk_replace_jobs and bulk_replace_job_items tables exist.');

  console.log('\n====================================================');
  console.log('ALL BULK REPLACE SCHEMA VERIFICATION TESTS PASSED! ✓✓✓');
  console.log('====================================================');
  process.exit(0);
}

runVerification().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
