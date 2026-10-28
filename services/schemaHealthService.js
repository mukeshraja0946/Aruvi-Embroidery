const db = require('../config/db');
const { getMigrationStatus } = require('./migrationRunner');

/**
 * Complete canonical schema requirement specification across the entire codebase.
 * Every table and required column that models, controllers, and services expect.
 */
const REQUIRED_SCHEMA = {
  schema_migrations: ['id', 'version', 'name', 'applied_at'],
  roles: ['id', 'name', 'description'],
  users: ['id', 'full_name', 'email', 'password_hash', 'phone', 'address', 'profile_picture', 'role', 'is_active', 'created_at'],
  categories: ['id', 'name', 'slug', 'description', 'image_url', 'display_order', 'is_active', 'created_at'],
  designs: [
    'id', 'title', 'sku', 'slug', 'short_description', 'description', 'price', 'sale_price',
    'category_id', 'sub_category', 'hoop_size', 'stitch_count', 'stitch_count_front',
    'stitch_count_back', 'stitch_count_sleeve', 'stitch_count_total', 'stitch_total_manual',
    'dimensions', 'formats', 'is_featured', 'is_trending', 'is_active', 'needs_reupload', 'download_count',
    'tags', 'total_sales', 'average_rating', 'reviews_count', 'import_image_filename',
    'import_zip_filename', 'primary_image', 'original_image_url', 'deleted_at', 'created_at'
  ],
  design_images: ['id', 'design_id', 'image_url', 'thumb_key', 'card_key', 'original_key', 'is_primary', 'display_order'],
  design_files: ['id', 'design_id', 'file_kind', 'label', 'original_name', 'storage_key', 'mime_type', 'file_size', 'checksum_sha256', 'sort_order', 'is_primary_preview', 'created_at'],
  cart_items: ['id', 'user_id', 'session_id', 'design_id', 'quantity', 'created_at'],
  orders: ['id', 'order_number', 'user_id', 'total_amount', 'discount_amount', 'final_amount', 'coupon_code', 'status', 'razorpay_order_id', 'razorpay_payment_id', 'payment_gateway', 'cashfree_order_id', 'cashfree_payment_id', 'created_at'],
  order_items: ['id', 'order_id', 'design_id', 'quantity', 'price_at_purchase', 'mrp', 'discount_amount', 'created_at'],
  custom_orders: ['id', 'user_id', 'full_name', 'email', 'phone', 'design_details', 'status', 'created_at'],
  banners: ['id', 'title', 'image_url', 'link_url', 'display_order', 'is_active', 'created_at'],
  payments: ['id', 'order_id', 'amount', 'status', 'payment_method', 'created_at'],
  coupons: ['id', 'code', 'discount_type', 'discount_value', 'min_purchase', 'is_active', 'created_at'],
  reviews: ['id', 'design_id', 'user_id', 'rating', 'comment', 'is_approved', 'created_at'],
  wishlist: ['id', 'user_id', 'design_id', 'created_at'],
  contact_messages: ['id', 'name', 'email', 'phone', 'subject', 'message', 'status', 'source', 'is_read', 'created_at'],
  settings: ['id', 'setting_key', 'setting_value', 'updated_at'],
  site_settings: ['id', 'setting_key', 'setting_value', 'setting_group', 'updated_at'],
  activity_logs: ['id', 'user_id', 'admin_name', 'action', 'entity_type', 'entity_id', 'details', 'created_at'],
  download_logs: ['id', 'user_id', 'design_id', 'file_id', 'ip_address', 'downloaded_at'],
  file_scan_results: ['id', 'design_id', 'title', 'sku', 'category_name', 'price', 'is_active', 'image_url', 'image_status', 'file_path', 'file_name', 'file_status', 'scanned_at'],
  scan_jobs: ['id', 'status', 'total_designs', 'scanned_designs', 'missing_images', 'missing_files', 'missing_both', 'started_at', 'completed_at', 'created_at'],
  import_jobs: ['id', 'batch_id', 'status', 'total_rows', 'valid_rows', 'error_rows', 'duplicate_rows', 'imported_count', 'skipped_count', 'failed_count', 'update_existing', 'spreadsheet_filename', 'created_at', 'completed_at'],
  import_job_items: ['id', 'job_id', 'row_no', 'sku', 'title', 'category_name', 'price', 'sale_price', 'formats', 'image_filename', 'image_stored_url', 'file_filename', 'file_stored_path', 'stitch_count_front', 'stitch_count_back', 'stitch_count_sleeve', 'stitch_count_total', 'stitch_total_manual', 'validation_status', 'import_status'],
  email_campaigns: ['id', 'subject', 'body_html', 'total_recipients', 'success_count', 'failed_count', 'status', 'created_at'],
  email_campaign_logs: ['id', 'campaign_id', 'recipient_email', 'status', 'error_message', 'created_at'],
  unsubscribed_customers: ['id', 'email', 'created_at'],
  price_update_logs: ['id', 'admin_id', 'admin_email', 'filter_summary', 'method_summary', 'total_affected', 'is_undone', 'created_at'],
  price_update_log_items: ['id', 'log_id', 'design_id', 'sku', 'old_mrp', 'old_price', 'new_mrp', 'new_price', 'created_at'],
  stitch_update_logs: ['id', 'admin_id', 'admin_email', 'filter_summary', 'method_summary', 'total_affected', 'is_undone', 'created_at'],
  stitch_update_log_items: ['id', 'log_id', 'design_id', 'sku', 'old_front', 'old_back', 'old_sleeve', 'old_total', 'old_manual', 'new_front', 'new_back', 'new_sleeve', 'new_total', 'new_manual', 'created_at'],
  image_replace_logs: ['id', 'admin_id', 'admin_email', 'category_id', 'category_name', 'scope_summary', 'replacement_mode', 'total_files', 'matched_designs', 'replaced_count', 'skipped_count', 'failed_count', 'is_undone', 'created_at'],
  image_replace_log_items: ['id', 'log_id', 'design_id', 'sku', 'title', 'old_primary_image', 'new_primary_image', 'old_images_json', 'new_images_json', 'status', 'created_at'],
  upload_sessions: ['id', 'user_id', 'filename', 'file_size', 'total_chunks', 'uploaded_chunks', 'upload_type', 'status', 'error_message', 'reference_id', 'created_at', 'updated_at']
};

/**
 * Checks the database against the required schema specification.
 */
async function checkSystemHealth() {
  if (!db.isConnected()) {
    try {
      await db.initPool();
    } catch {}
  }

  if (!db.isConnected()) {
    return {
      connected: false,
      databaseName: process.env.DB_NAME || 'aruvi_embroidery',
      host: process.env.DB_HOST || 'localhost',
      tables: [],
      missingTables: Object.keys(REQUIRED_SCHEMA),
      missingColumns: [],
      stats: {
        totalExpectedTables: Object.keys(REQUIRED_SCHEMA).length,
        existingTablesCount: 0,
        missingTablesCount: Object.keys(REQUIRED_SCHEMA).length,
        totalExpectedColumns: 0,
        existingColumnsCount: 0,
        missingColumnsCount: 0,
        healthPercentage: 0
      },
      migrations: { total: 0, appliedCount: 0, pendingCount: 0, isUpToDate: false, migrations: [] },
      isHealthy: false
    };
  }

  try {
    // 1. Fetch all existing tables
    const tablesRows = await db.query(`
      SELECT table_name AS tableName
      FROM information_schema.tables 
      WHERE table_schema = DATABASE()
    `);
    const existingTableNames = new Set((tablesRows || []).map(r => r.tableName || r.table_name || Object.values(r)[0]));

    // 2. Fetch all existing columns
    const columnsRows = await db.query(`
      SELECT table_name AS tableName, column_name AS columnName 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE()
    `);
    const existingColumnsMap = new Map(); // tableName -> Set of columns
    (columnsRows || []).forEach(r => {
      const t = r.tableName || r.table_name;
      const c = r.columnName || r.column_name;
      if (!existingColumnsMap.has(t)) {
        existingColumnsMap.set(t, new Set());
      }
      existingColumnsMap.get(t).add(c);
    });

    // 3. Compare with REQUIRED_SCHEMA
    const tableReport = [];
    let totalCols = 0;
    let existingCols = 0;
    let missingCols = 0;
    const missingTablesList = [];
    const missingColumnsList = [];

    for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
      const tableExists = existingTableNames.has(tableName);
      const colsInDb = existingColumnsMap.get(tableName) || new Set();

      const columnsReport = requiredColumns.map(col => {
        totalCols++;
        const colExists = tableExists && colsInDb.has(col);
        if (colExists) {
          existingCols++;
        } else {
          missingCols++;
          missingColumnsList.push({ table: tableName, column: col });
        }
        return {
          name: col,
          exists: colExists
        };
      });

      if (!tableExists) {
        missingTablesList.push(tableName);
      }

      tableReport.push({
        name: tableName,
        exists: tableExists,
        columns: columnsReport,
        missingColumnCount: columnsReport.filter(c => !c.exists).length,
        isFullyHealthy: tableExists && columnsReport.every(c => c.exists)
      });
    }

    const totalTables = Object.keys(REQUIRED_SCHEMA).length;
    const existingTablesCount = totalTables - missingTablesList.length;
    const healthPercentage = totalCols > 0 ? Math.round((existingCols / totalCols) * 100) : 0;

    // 4. Migration status
    const migrations = await getMigrationStatus();

    const isHealthy = missingTablesList.length === 0 && missingCols === 0 && migrations.isUpToDate;

    return {
      connected: true,
      databaseName: process.env.DB_NAME || 'aruvi_embroidery',
      host: process.env.DB_HOST || 'localhost',
      tables: tableReport,
      missingTables: missingTablesList,
      missingColumns: missingColumnsList,
      stats: {
        totalExpectedTables: totalTables,
        existingTablesCount,
        missingTablesCount: missingTablesList.length,
        totalExpectedColumns: totalCols,
        existingColumnsCount: existingCols,
        missingColumnsCount: missingCols,
        healthPercentage
      },
      migrations,
      isHealthy
    };
  } catch (err) {
    console.error('[checkSystemHealth error]:', err.message);
    throw err;
  }
}

/**
 * Fast schema safety check run on application startup.
 * Returns { isHealthy, missingTables, missingColumns, missingSummary }
 * and logs loud warnings if any tables or columns are missing.
 */
async function checkSchemaSafetyOnStartup() {
  try {
    const health = await checkSystemHealth();
    if (!health.connected) {
      return {
        isHealthy: false,
        missingTables: health.missingTables,
        missingColumns: health.missingColumns,
        missingSummary: 'Database offline or unreachable'
      };
    }

    if (!health.isHealthy) {
      const missingList = [
        ...health.missingTables.map(t => `table:${t}`),
        ...health.missingColumns.map(c => `${c.table}.${c.column}`)
      ];

      if (health.migrations && !health.migrations.isUpToDate && health.migrations.pending && health.migrations.pending.length > 0) {
        missingList.push(...health.migrations.pending.map(p => `migration:${p.file}`));
      }

      console.error('====================================================');
      console.error('🚨 [DATABASE SCHEMA INTEGRITY WARNING]');
      console.error(`   Found ${missingList.length} missing database element(s):`);
      missingList.forEach(m => console.error(`     - ❌ Missing ${m}`));
      console.error('   Action: Run "npm run migrate" or click "Apply Pending Migrations" in Admin → Tools → System Health.');
      console.error('====================================================');

      const summaryText = missingList.length > 0
        ? missingList.slice(0, 4).join(', ') + (missingList.length > 4 ? ` (+${missingList.length - 4} more)` : '')
        : (health.migrations && !health.migrations.isUpToDate ? 'Pending database migrations' : 'Incomplete database schema');

      return {
        isHealthy: false,
        missingTables: health.missingTables,
        missingColumns: health.missingColumns,
        missingSummary: summaryText
      };
    }

    return {
      isHealthy: true,
      missingTables: [],
      missingColumns: [],
      missingSummary: ''
    };
  } catch (err) {
    console.warn('[Startup Schema Check Warning]:', err.message);
    return {
      isHealthy: false,
      missingTables: [],
      missingColumns: [],
      missingSummary: err.message
    };
  }
}

module.exports = {
  checkSystemHealth,
  checkSchemaSafetyOnStartup,
  REQUIRED_SCHEMA
};
