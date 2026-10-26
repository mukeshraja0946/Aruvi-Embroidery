const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const storage = require('../config/storage');
const ActivityLog = require('../models/ActivityLog');

const projectRoot = path.resolve(__dirname, '..');
const primaryBackupsDir = path.join(projectRoot, 'storage_private', 'backups');
const legacyBackupsDir = path.join(projectRoot, 'backups');

function ensureBackupDirs() {
  [primaryBackupsDir, legacyBackupsDir].forEach(d => {
    if (!fs.existsSync(d)) {
      try {
        fs.mkdirSync(d, { recursive: true });
      } catch (_) {}
    }
  });
}

/**
 * Escapes values for SQL insert statements safely
 */
function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
  const str = String(val).replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, (char) => {
    switch (char) {
      case '\0': return '\\0';
      case '\x08': return '\\b';
      case '\x09': return '\\t';
      case '\x1a': return '\\z';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '"':
      case "'":
      case '\\':
      case '%':
        return '\\' + char;
      default: return char;
    }
  });
  return `'${str}'`;
}

/**
 * Escapes values for CSV rows
 */
function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

class AdminResetService {
  /**
   * Retrieves live counts for all selective clear categories
   */
  static async getLiveCounts() {
    if (!db.isConnected()) {
      await db.initPool();
    }

    const counts = {
      orders: {
        total: 0,
        unpaidOrPending: 0,
        testMode: 0,
        livePaid: 0,
        livePaidAmount: 0,
        payments: 0
      },
      customers: {
        testCustomers: 0,
        realCustomers: 0,
        adminCount: 0
      },
      operational: {
        customOrders: 0,
        contactMessages: 0,
        reviews: 0,
        wishlists: 0,
        carts: 0,
        couponsUsed: 0,
        newsletterSubscribers: 0,
        emailLogs: 0
      },
      statistics: {
        totalDownloads: 0,
        activityLogs: 0,
        importJobs: 0,
        stitchPriceLogs: 0
      },
      demoDesigns: 0,
      dangerAllDesigns: 0
    };

    if (!db.isConnected()) return counts;

    try {
      // 1. Orders & Payments
      const [allOrd] = await db.query("SELECT COUNT(*) as cnt FROM orders");
      const [unpaidOrd] = await db.query("SELECT COUNT(*) as cnt FROM orders WHERE status NOT IN ('completed', 'paid')");
      const [testOrd] = await db.query("SELECT COUNT(*) as cnt FROM orders WHERE is_test = 1");
      const [livePaidOrd] = await db.query("SELECT COUNT(*) as cnt, COALESCE(SUM(final_amount), 0) as amount FROM orders WHERE is_test = 0 AND status IN ('completed', 'paid')");
      const [payCount] = await db.query("SELECT COUNT(*) as cnt FROM payments");

      counts.orders.total = Number(allOrd?.cnt || 0);
      counts.orders.unpaidOrPending = Number(unpaidOrd?.cnt || 0);
      counts.orders.testMode = Number(testOrd?.cnt || 0);
      counts.orders.livePaid = Number(livePaidOrd?.cnt || 0);
      counts.orders.livePaidAmount = parseFloat(livePaidOrd?.amount || 0);
      counts.orders.payments = Number(payCount?.cnt || 0);

      // 2. Customers
      const [testCust] = await db.query(`
        SELECT COUNT(*) as cnt FROM users u
        WHERE (u.role = 'customer' OR u.role IS NULL OR u.role = '')
          AND u.role NOT IN ('admin', 'super_admin')
          AND NOT EXISTS (
            SELECT 1 FROM orders o 
            WHERE o.user_id = u.id 
              AND o.status IN ('completed', 'paid') 
              AND (o.is_test = 0 OR o.is_test IS NULL)
          )
      `);
      const [realCust] = await db.query(`
        SELECT COUNT(*) as cnt FROM users u
        WHERE (u.role = 'customer' OR u.role IS NULL OR u.role = '')
          AND u.role NOT IN ('admin', 'super_admin')
          AND EXISTS (
            SELECT 1 FROM orders o 
            WHERE o.user_id = u.id 
              AND o.status IN ('completed', 'paid') 
              AND (o.is_test = 0 OR o.is_test IS NULL)
          )
      `);
      const [admins] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE role IN ('admin', 'super_admin')");

      counts.customers.testCustomers = Number(testCust?.cnt || 0);
      counts.customers.realCustomers = Number(realCust?.cnt || 0);
      counts.customers.adminCount = Number(admins?.cnt || 0);

      // 3. Operational Data
      try {
        const [cOrd] = await db.query("SELECT COUNT(*) as cnt FROM custom_orders");
        counts.operational.customOrders = Number(cOrd?.cnt || 0);
      } catch (_) {}

      try {
        const [cMsg] = await db.query("SELECT COUNT(*) as cnt FROM contact_messages");
        counts.operational.contactMessages = Number(cMsg?.cnt || 0);
      } catch (_) {}

      try {
        const [cRev] = await db.query("SELECT COUNT(*) as cnt FROM reviews");
        counts.operational.reviews = Number(cRev?.cnt || 0);
      } catch (_) {}

      try {
        const [cWish] = await db.query("SELECT COUNT(*) as cnt FROM wishlist");
        counts.operational.wishlists = Number(cWish?.cnt || 0);
      } catch (_) {}

      try {
        const [cCart] = await db.query("SELECT COUNT(*) as cnt FROM cart_items");
        counts.operational.carts = Number(cCart?.cnt || 0);
      } catch (_) {}

      try {
        const [cCp] = await db.query("SELECT COUNT(*) as cnt FROM coupons WHERE times_used > 0");
        counts.operational.couponsUsed = Number(cCp?.cnt || 0);
      } catch (_) {}

      try {
        const [cSub] = await db.query("SELECT COUNT(*) as cnt FROM unsubscribed_customers");
        counts.operational.newsletterSubscribers = Number(cSub?.cnt || 0);
      } catch (_) {}

      try {
        const [cMail] = await db.query("SELECT COUNT(*) as cnt FROM email_campaign_logs");
        counts.operational.emailLogs = Number(cMail?.cnt || 0);
      } catch (_) {}

      // 4. Statistics Counters
      try {
        const [dCount] = await db.query("SELECT COALESCE(SUM(download_count), 0) as cnt FROM designs");
        counts.statistics.totalDownloads = Number(dCount?.cnt || 0);
      } catch (_) {}

      try {
        const [actLog] = await db.query("SELECT COUNT(*) as cnt FROM activity_logs");
        counts.statistics.activityLogs = Number(actLog?.cnt || 0);
      } catch (_) {}

      try {
        const [impJob] = await db.query("SELECT COUNT(*) as cnt FROM import_jobs");
        counts.statistics.importJobs = Number(impJob?.cnt || 0);
      } catch (_) {}

      try {
        const [pLog] = await db.query("SELECT COUNT(*) as cnt FROM price_update_logs");
        const [sLog] = await db.query("SELECT COUNT(*) as cnt FROM stitch_update_logs");
        counts.statistics.stitchPriceLogs = Number(pLog?.cnt || 0) + Number(sLog?.cnt || 0);
      } catch (_) {}

      // 5. Demo Designs
      const [demoDes] = await db.query("SELECT COUNT(*) as cnt FROM designs WHERE is_demo = 1 AND deleted_at IS NULL");
      counts.demoDesigns = Number(demoDes?.cnt || 0);

      // 6. Danger All Designs
      const [allDes] = await db.query("SELECT COUNT(*) as cnt FROM designs WHERE deleted_at IS NULL");
      counts.dangerAllDesigns = Number(allDes?.cnt || 0);
    } catch (err) {
      console.error('[AdminResetService.getLiveCounts error]:', err);
    }

    return counts;
  }

  /**
   * Generates a preview calculation based on requested options
   */
  static async getPreview(options = {}) {
    const liveCounts = await this.getLiveCounts();
    const {
      ordersScope = 'none', // 'none' | 'all' | 'unpaid_pending' | 'test_mode' | 'before_date'
      ordersBeforeDate = null,
      clearCustomers = false,
      clearOperational = false,
      clearStats = false,
      clearDemoDesigns = false,
      clearAllDesignsDanger = false,
      deleteRealPaidOrders = false
    } = options;

    let ordersToDelete = 0;
    let paymentsToDelete = 0;
    let revenueDeduction = 0;
    let hasLivePaidOrdersInScope = false;
    let livePaidOrdersInScopeCount = 0;
    let livePaidOrdersInScopeAmount = 0;

    if (ordersScope !== 'none') {
      let orderQuery = '';
      const params = [];

      if (ordersScope === 'all') {
        orderQuery = 'SELECT id, is_test, status, final_amount FROM orders';
      } else if (ordersScope === 'unpaid_pending') {
        orderQuery = "SELECT id, is_test, status, final_amount FROM orders WHERE status NOT IN ('completed', 'paid')";
      } else if (ordersScope === 'test_mode') {
        orderQuery = 'SELECT id, is_test, status, final_amount FROM orders WHERE is_test = 1';
      } else if (ordersScope === 'before_date' && ordersBeforeDate) {
        orderQuery = 'SELECT id, is_test, status, final_amount FROM orders WHERE created_at < ?';
        params.push(new Date(ordersBeforeDate));
      }

      if (orderQuery) {
        const candidateOrders = await db.query(orderQuery, params);
        ordersToDelete = candidateOrders.length;

        candidateOrders.forEach(o => {
          const isLivePaid = (o.is_test === 0 || o.is_test === null) && (o.status === 'completed' || o.status === 'paid');
          if (isLivePaid) {
            hasLivePaidOrdersInScope = true;
            livePaidOrdersInScopeCount++;
            livePaidOrdersInScopeAmount += parseFloat(o.final_amount || 0);
          }
          if (o.status === 'completed' || o.status === 'paid') {
            revenueDeduction += parseFloat(o.final_amount || 0);
          }
        });

        // Estimate matching payments
        if (ordersToDelete > 0) {
          const orderIds = candidateOrders.map(o => o.id);
          const [pRes] = await db.query(`SELECT COUNT(*) as cnt FROM payments WHERE order_id IN (${orderIds.join(',')})`);
          paymentsToDelete = Number(pRes?.cnt || 0);
        }
      }
    }

    // Current real revenue
    const [currRevRes] = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid') AND (is_test = 0 OR is_test IS NULL)");
    const currentRealRevenue = parseFloat(currRevRes?.total || 0);
    const newProjectedRevenue = Math.max(0, currentRealRevenue - (deleteRealPaidOrders ? livePaidOrdersInScopeAmount : 0));

    return {
      ordersToDelete,
      paymentsToDelete,
      customersToDelete: clearCustomers ? liveCounts.customers.testCustomers : 0,
      customOrdersToDelete: clearOperational ? liveCounts.operational.customOrders : 0,
      contactMessagesToDelete: clearOperational ? liveCounts.operational.contactMessages : 0,
      reviewsToDelete: clearOperational ? liveCounts.operational.reviews : 0,
      wishlistsToDelete: clearOperational ? liveCounts.operational.wishlists : 0,
      cartsToDelete: clearOperational ? liveCounts.operational.carts : 0,
      couponsResetCount: clearOperational ? liveCounts.operational.couponsUsed : 0,
      subscribersToDelete: clearOperational ? liveCounts.operational.newsletterSubscribers : 0,
      emailLogsToDelete: clearOperational ? liveCounts.operational.emailLogs : 0,
      downloadsResetCount: clearStats ? liveCounts.statistics.totalDownloads : 0,
      activityLogsToDelete: clearStats ? liveCounts.statistics.activityLogs : 0,
      importJobsToDelete: clearStats ? liveCounts.statistics.importJobs : 0,
      stitchPriceLogsToDelete: clearStats ? liveCounts.statistics.stitchPriceLogs : 0,
      demoDesignsToDelete: clearDemoDesigns ? liveCounts.demoDesigns : 0,
      dangerAllDesignsToDelete: clearAllDesignsDanger ? liveCounts.dangerAllDesigns : 0,
      hasLivePaidOrdersInScope,
      livePaidOrdersInScopeCount,
      livePaidOrdersInScopeAmount,
      currentRealRevenue,
      newProjectedRevenue,
      revenueDeduction
    };
  }

  /**
   * Generates a SQL dump and CSV export of targeted tables before any data is modified
   */
  static async createPreResetBackup(targetTables = []) {
    ensureBackupDirs();
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupSqlName = `reset_backup_${timestamp}.sql`;
    const backupCsvName = `reset_backup_${timestamp}.csv`;
    const sqlPath = path.join(primaryBackupsDir, backupSqlName);
    const csvPath = path.join(primaryBackupsDir, backupCsvName);

    // Default tables if none specified
    const tablesToDump = targetTables.length > 0 ? targetTables : [
      'orders', 'order_items', 'payments', 'download_logs', 'users',
      'custom_orders', 'contact_messages', 'reviews', 'wishlist', 'cart_items',
      'coupons', 'unsubscribed_customers', 'email_campaign_logs',
      'designs', 'design_files', 'design_images', 'activity_logs',
      'import_jobs', 'import_job_items', 'price_update_logs', 'stitch_update_logs'
    ];

    const sqlLines = [];
    sqlLines.push(`-- Aruvi Embroidery Store Pre-Reset Backup`);
    sqlLines.push(`-- Created: ${now.toISOString()}`);
    sqlLines.push(`-- Target Tables: ${tablesToDump.join(', ')}`);
    sqlLines.push(`SET FOREIGN_KEY_CHECKS = 0;\n`);

    const csvLines = [];
    csvLines.push('table_name,record_count,exported_at');

    for (const table of tablesToDump) {
      try {
        const tableExists = await db.query('SHOW TABLES LIKE ?', [table]);
        if (!tableExists || tableExists.length === 0) continue;

        // Table schema
        const createRes = await db.query(`SHOW CREATE TABLE \`${table}\``);
        if (createRes && createRes[0]) {
          sqlLines.push(`DROP TABLE IF EXISTS \`${table}\`;`);
          sqlLines.push(`${createRes[0]['Create Table']};\n`);
        }

        // Table rows
        const rows = await db.query(`SELECT * FROM \`${table}\``);
        if (rows && rows.length > 0) {
          csvLines.push(`${table},${rows.length},"${now.toISOString()}"`);
          for (const row of rows) {
            const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
            const vals = Object.values(row).map(escapeSqlValue).join(', ');
            sqlLines.push(`INSERT INTO \`${table}\` (${cols}) VALUES (${vals});`);
          }
          sqlLines.push('');
        } else {
          csvLines.push(`${table},0,"${now.toISOString()}"`);
        }
      } catch (dumpErr) {
        console.warn(`[AdminResetService.createPreResetBackup] Warning dumping ${table}:`, dumpErr.message);
      }
    }

    sqlLines.push(`SET FOREIGN_KEY_CHECKS = 1;\n`);
    fs.writeFileSync(sqlPath, sqlLines.join('\n'), 'utf8');
    fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

    // Also copy to legacyBackupsDir so Admin -> Tools -> Backups page immediately lists it
    try {
      fs.copyFileSync(sqlPath, path.join(legacyBackupsDir, backupSqlName));
      fs.copyFileSync(csvPath, path.join(legacyBackupsDir, backupCsvName));
    } catch (_) {}

    // Prune backups older than 30 days
    this.pruneOldBackups();

    const stats = fs.statSync(sqlPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    return {
      filename: backupSqlName,
      csvFilename: backupCsvName,
      sizeMb,
      createdAt: now
    };
  }

  /**
   * Prunes backup files older than 30 days
   */
  static pruneOldBackups() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    [primaryBackupsDir, legacyBackupsDir].forEach(dir => {
      if (!fs.existsSync(dir)) return;
      try {
        const files = fs.readdirSync(dir);
        files.forEach(f => {
          const fullPath = path.join(dir, f);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs < thirtyDaysAgo) {
              fs.unlinkSync(fullPath);
            }
          } catch (_) {}
        });
      } catch (_) {}
    });
  }

  /**
   * Executes the atomic reset operation with all safety validations
   */
  static async executeReset(options = {}, adminUser, req) {
    if (!adminUser || !adminUser.id) {
      throw new Error('Unauthorized. Valid admin session is required.');
    }

    const {
      password = '',
      confirmResetText = '',
      confirmUnderstand = false,
      ordersScope = 'none', // 'none' | 'all' | 'unpaid_pending' | 'test_mode' | 'before_date'
      ordersBeforeDate = null,
      clearCustomers = false,
      clearOperational = false,
      clearStats = false,
      clearDemoDesigns = false,
      clearAllDesignsDanger = false,
      deleteRealPaidOrders = false,
      restartOrderNumbers = false
    } = options;

    // 1. Strict Validation: Password verification
    const [adminRow] = await db.query('SELECT id, email, password_hash, role FROM users WHERE id = ? LIMIT 1', [adminUser.id]);
    if (!adminRow || !adminRow.password_hash) {
      throw new Error('Admin user record could not be verified.');
    }
    const isPassValid = await bcrypt.compare(password, adminRow.password_hash);
    if (!isPassValid) {
      throw new Error('Incorrect admin password. Data reset cancelled.');
    }

    // 2. Strict Validation: Confirmation string and checkbox
    if (confirmResetText.trim().toUpperCase() !== 'RESET') {
      throw new Error('Confirmation text mismatch. You must type RESET in all capital letters.');
    }
    if (!confirmUnderstand) {
      throw new Error('You must confirm that you understand this action cannot be undone.');
    }

    // 3. Pre-check live paid orders safety
    const preview = await this.getPreview(options);
    if (preview.hasLivePaidOrdersInScope && !deleteRealPaidOrders) {
      throw new Error(
        `Selected order scope includes ${preview.livePaidOrdersInScopeCount} real paid order(s) (₹${preview.livePaidOrdersInScopeAmount}). You must explicitly tick "Delete real paid orders too" to clear them.`
      );
    }

    // 4. Create Pre-Reset Backup
    const backupResult = await this.createPreResetBackup();

    // 5. Atomic MySQL Transaction
    const pool = db.pool();
    const connection = await pool.getConnection();

    const summaryCounts = {
      orders: 0,
      payments: 0,
      customers: 0,
      customOrders: 0,
      contactMessages: 0,
      reviews: 0,
      wishlists: 0,
      carts: 0,
      couponsReset: 0,
      subscribers: 0,
      emailLogs: 0,
      downloadsReset: 0,
      activityLogs: 0,
      importJobs: 0,
      stitchPriceLogs: 0,
      demoDesigns: 0,
      allDesigns: 0
    };

    try {
      await connection.beginTransaction();

      // A) CLEAR ORDERS & PAYMENTS
      if (ordersScope !== 'none') {
        let orderSelectSql = '';
        const orderParams = [];

        if (ordersScope === 'all') {
          if (deleteRealPaidOrders) {
            orderSelectSql = 'SELECT id FROM orders';
          } else {
            orderSelectSql = "SELECT id FROM orders WHERE is_test = 1 OR status NOT IN ('completed', 'paid')";
          }
        } else if (ordersScope === 'unpaid_pending') {
          orderSelectSql = "SELECT id FROM orders WHERE status NOT IN ('completed', 'paid')";
        } else if (ordersScope === 'test_mode') {
          orderSelectSql = 'SELECT id FROM orders WHERE is_test = 1';
        } else if (ordersScope === 'before_date' && ordersBeforeDate) {
          if (deleteRealPaidOrders) {
            orderSelectSql = 'SELECT id FROM orders WHERE created_at < ?';
          } else {
            orderSelectSql = "SELECT id FROM orders WHERE created_at < ? AND (is_test = 1 OR status NOT IN ('completed', 'paid'))";
          }
          orderParams.push(new Date(ordersBeforeDate));
        }

        if (orderSelectSql) {
          const [orderRows] = await connection.query(orderSelectSql, orderParams);
          const orderIds = (orderRows || []).map(r => r.id);

          if (orderIds.length > 0) {
            const inClause = orderIds.join(',');

            // 1. Delete download_logs related to these orders
            await connection.query(`
              DELETE dl FROM download_logs dl
              JOIN order_items oi ON dl.design_id = oi.design_id
              WHERE oi.order_id IN (${inClause})
            `);

            // 2. Delete payments
            const [delPay] = await connection.query(`DELETE FROM payments WHERE order_id IN (${inClause})`);
            summaryCounts.payments = delPay?.affectedRows || 0;

            // 3. Delete order_items
            await connection.query(`DELETE FROM order_items WHERE order_id IN (${inClause})`);

            // 4. Delete orders
            const [delOrd] = await connection.query(`DELETE FROM orders WHERE id IN (${inClause})`);
            summaryCounts.orders = delOrd?.affectedRows || 0;

            // Reset AUTO_INCREMENT if requested and table is empty
            if (restartOrderNumbers) {
              const [[remainingOrders]] = await connection.query('SELECT COUNT(*) as cnt FROM orders');
              if (Number(remainingOrders?.cnt || 0) === 0) {
                await connection.query('ALTER TABLE orders AUTO_INCREMENT = 1');
                await connection.query('ALTER TABLE order_items AUTO_INCREMENT = 1');
                await connection.query('ALTER TABLE payments AUTO_INCREMENT = 1');
              }
            }
          }
        }
      }

      // B) CLEAR TEST CUSTOMERS (Users with no real completed paid order; NEVER delete admins)
      if (clearCustomers) {
        const [candUsers] = await connection.query(`
          SELECT id FROM users
          WHERE (role = 'customer' OR role IS NULL OR role = '')
            AND role NOT IN ('admin', 'super_admin')
            AND NOT EXISTS (
              SELECT 1 FROM orders o 
              WHERE o.user_id = users.id 
                AND o.status IN ('completed', 'paid') 
                AND (o.is_test = 0 OR o.is_test IS NULL)
            )
        `);

        const userIds = (candUsers || []).map(u => u.id);
        if (userIds.length > 0) {
          const uIn = userIds.join(',');

          // Delete dependent user records
          await connection.query(`DELETE FROM cart_items WHERE user_id IN (${uIn})`);
          await connection.query(`DELETE FROM wishlist WHERE user_id IN (${uIn})`);
          await connection.query(`DELETE FROM reviews WHERE user_id IN (${uIn})`);
          await connection.query(`DELETE FROM download_logs WHERE user_id IN (${uIn})`);
          await connection.query(`DELETE FROM custom_orders WHERE user_id IN (${uIn})`);

          // Nullify user_id on any lingering test orders
          await connection.query(`UPDATE orders SET user_id = NULL WHERE user_id IN (${uIn})`);

          // Delete test users
          const [delUsers] = await connection.query(`DELETE FROM users WHERE id IN (${uIn})`);
          summaryCounts.customers = delUsers?.affectedRows || 0;
        }
      }

      // C) CLEAR OPERATIONAL DATA
      if (clearOperational) {
        // Custom orders
        const [delCO] = await connection.query('DELETE FROM custom_orders');
        summaryCounts.customOrders = delCO?.affectedRows || 0;

        // Contact messages
        const [delCM] = await connection.query('DELETE FROM contact_messages');
        summaryCounts.contactMessages = delCM?.affectedRows || 0;

        // Reviews
        const [delRev] = await connection.query('DELETE FROM reviews');
        summaryCounts.reviews = delRev?.affectedRows || 0;
        await connection.query('UPDATE designs SET reviews_count = 0, average_rating = 0.00');

        // Wishlists
        const [delWish] = await connection.query('DELETE FROM wishlist');
        summaryCounts.wishlists = delWish?.affectedRows || 0;

        // Carts
        const [delCart] = await connection.query('DELETE FROM cart_items');
        summaryCounts.carts = delCart?.affectedRows || 0;

        // Coupons usage counts
        const [resetCp] = await connection.query('UPDATE coupons SET times_used = 0');
        summaryCounts.couponsReset = resetCp?.affectedRows || 0;

        // Newsletter subscribers
        try {
          const [delSub] = await connection.query('DELETE FROM unsubscribed_customers');
          summaryCounts.subscribers = delSub?.affectedRows || 0;
        } catch (_) {}

        // Email campaign logs
        try {
          const [delMail] = await connection.query('DELETE FROM email_campaign_logs');
          summaryCounts.emailLogs = delMail?.affectedRows || 0;
        } catch (_) {}
      }

      // D) CLEAR STATISTICS COUNTERS & LOGS
      if (clearStats) {
        // Download count
        const [resetDl] = await connection.query('UPDATE designs SET download_count = 0');
        summaryCounts.downloadsReset = resetDl?.affectedRows || 0;

        // Activity logs (clears past logs; current reset event will be inserted fresh)
        const [delAct] = await connection.query('DELETE FROM activity_logs');
        summaryCounts.activityLogs = delAct?.affectedRows || 0;

        // Import jobs
        try {
          await connection.query('DELETE FROM import_job_items');
          const [delImp] = await connection.query('DELETE FROM import_jobs');
          summaryCounts.importJobs = delImp?.affectedRows || 0;
        } catch (_) {}

        // Stitch & price logs
        try {
          await connection.query('DELETE FROM price_update_log_items');
          const [delPrice] = await connection.query('DELETE FROM price_update_logs');
          await connection.query('DELETE FROM stitch_update_log_items');
          const [delStitch] = await connection.query('DELETE FROM stitch_update_logs');
          summaryCounts.stitchPriceLogs = (delPrice?.affectedRows || 0) + (delStitch?.affectedRows || 0);
        } catch (_) {}
      }

      // E) CLEAR DEMO DESIGNS (Only designs where is_demo = 1; NEVER real designs)
      if (clearDemoDesigns) {
        const [demoRows] = await connection.query('SELECT id FROM designs WHERE is_demo = 1');
        const demoIds = (demoRows || []).map(d => d.id);

        if (demoIds.length > 0) {
          const dIn = demoIds.join(',');
          await connection.query(`DELETE FROM design_files WHERE design_id IN (${dIn})`);
          await connection.query(`DELETE FROM design_images WHERE design_id IN (${dIn})`);
          await connection.query(`DELETE FROM cart_items WHERE design_id IN (${dIn})`);
          await connection.query(`DELETE FROM wishlist WHERE design_id IN (${dIn})`);
          await connection.query(`DELETE FROM reviews WHERE design_id IN (${dIn})`);
          await connection.query(`DELETE FROM order_items WHERE design_id IN (${dIn})`);
          const [delDemo] = await connection.query(`DELETE FROM designs WHERE id IN (${dIn})`);
          summaryCounts.demoDesigns = delDemo?.affectedRows || 0;
        }
      }

      // F) DANGER SECTION: DELETE ALL DESIGNS (Off by default, requires explicit confirmation)
      if (clearAllDesignsDanger) {
        await connection.query('DELETE FROM design_files');
        await connection.query('DELETE FROM design_images');
        await connection.query('DELETE FROM cart_items');
        await connection.query('DELETE FROM wishlist');
        await connection.query('DELETE FROM reviews');
        await connection.query('DELETE FROM order_items');
        const [delAllDes] = await connection.query('DELETE FROM designs');
        summaryCounts.allDesigns = delAllDes?.affectedRows || 0;
      }

      await connection.commit();
    } catch (txErr) {
      await connection.rollback();
      throw txErr;
    } finally {
      connection.release();
    }

    // 6. Write Audit Trail to activity_logs
    const auditSummary = `Reset data executed by ${adminUser.email || 'Admin'}. Removed: ${summaryCounts.orders} orders, ${summaryCounts.payments} payments, ${summaryCounts.customers} test customers, ${summaryCounts.customOrders} requests, ${summaryCounts.contactMessages} enquiries. Backup: ${backupResult.filename}`;
    try {
      if (req && typeof ActivityLog.logFromReq === 'function') {
        await ActivityLog.logFromReq(req, 'reset_data', 'system', null, auditSummary);
      } else {
        await ActivityLog.log({
          userId: adminUser.id,
          adminName: adminUser.full_name || adminUser.email || 'Admin',
          action: 'reset_data',
          entityType: 'system',
          details: auditSummary
        });
      }
    } catch (_) {}

    return {
      success: true,
      message: `Reset complete: ${summaryCounts.orders} orders, ${summaryCounts.customers} customers removed. Backup saved.`,
      summaryCounts,
      backup: backupResult
    };
  }

  /**
   * Restores database from a previously saved SQL backup file
   */
  static async restoreBackup(filename, adminUser, password) {
    if (!adminUser || !adminUser.id) {
      throw new Error('Unauthorized.');
    }

    const [adminRow] = await db.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [adminUser.id]);
    if (!adminRow || !adminRow.password_hash) {
      throw new Error('Admin account could not be verified.');
    }
    const isPassValid = await bcrypt.compare(password, adminRow.password_hash);
    if (!isPassValid) {
      throw new Error('Invalid admin password. Restore cancelled.');
    }

    const safeName = path.basename(filename);
    let targetPath = path.join(primaryBackupsDir, safeName);
    if (!fs.existsSync(targetPath)) {
      targetPath = path.join(legacyBackupsDir, safeName);
    }
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Backup file ${safeName} does not exist.`);
    }

    const sqlContent = fs.readFileSync(targetPath, 'utf8');
    const pool = db.pool();
    const connection = await pool.getConnection();

    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query(sqlContent);
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      connection.release();
    }

    await ActivityLog.log({
      userId: adminUser.id,
      adminName: adminUser.full_name || adminUser.email || 'Admin',
      action: 'restore_backup',
      entityType: 'system',
      details: `Restored database from backup: ${safeName}`
    });
    return { success: true, message: `Database successfully restored from ${safeName}` };
  }
}

module.exports = AdminResetService;
