const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const migrationsDir = path.resolve(__dirname, '..', 'migrations');

let currentMigrationState = {
  state: 'idle', // 'idle' | 'migrating' | 'ready' | 'degraded'
  pendingCount: 0,
  appliedCount: 0,
  failedCount: 0,
  durationMs: 0,
  error: null,
  lastRunAt: null
};

function getRunnerStatus() {
  return { ...currentMigrationState };
}

/**
 * Extracts a human-readable, descriptive message from any error, including AggregateError
 */
function formatErrorMessage(err) {
  if (!err) return 'Unknown database error';
  if (err.message && err.message.trim() !== '') return err.message;
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map(e => e.message || e.code || String(e)).filter(Boolean).join('; ');
  }
  if (err.code) return `Database error: ${err.code}`;
  if (err.sqlMessage) return err.sqlMessage;
  return String(err);
}

/**
 * Helper to get DB connection config
 */
function getDbConfig() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aruvi_embroidery',
    multipleStatements: true,
    connectTimeout: 5000,
    charset: 'utf8mb4'
  };

  const dbUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.CLEARDB_DATABASE_URL || process.env.JAWSDB_URL;
  if (dbUrl) {
    try {
      const parsedUrl = new URL(dbUrl);
      dbConfig.host = parsedUrl.hostname || dbConfig.host;
      dbConfig.port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : dbConfig.port;
      dbConfig.user = decodeURIComponent(parsedUrl.username || dbConfig.user);
      dbConfig.password = decodeURIComponent(parsedUrl.password || dbConfig.password);
      dbConfig.database = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : dbConfig.database;
    } catch (urlErr) {
      console.warn('[Migration Config Notice] Failed to parse DATABASE_URL string:', urlErr.message);
    }
  }

  return dbConfig;
}

/**
 * Returns all valid numbered migration files in numeric order
 */
function getAvailableMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs.readdirSync(migrationsDir)
    .filter(f => /^\d+.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Initializes the schema_migrations tracking table and migrates legacy _migrations if present
 */
async function ensureMigrationTable(connection) {
  // 1. Create schema_migrations table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`version\` VARCHAR(100) NOT NULL UNIQUE,
      \`name\` VARCHAR(255) NOT NULL,
      \`applied_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 2. Check if legacy _migrations table exists
  try {
    const [legacyCheck] = await connection.query(`
      SELECT COUNT(*) AS count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = '_migrations'
    `);

    if (legacyCheck && legacyCheck[0] && legacyCheck[0].count > 0) {
      await connection.query(`
        INSERT IGNORE INTO \`schema_migrations\` (\`version\`, \`name\`, \`applied_at\`)
        SELECT 
          SUBSTRING_INDEX(\`name\`, '_', 1) AS \`version\`,
          \`name\`,
          \`applied_at\`
        FROM \`_migrations\`
      `);
    }
  } catch (legacyCopyErr) {
    console.warn('[Migration Runner] Note on legacy _migrations sync:', legacyCopyErr.message);
  }
}

/**
 * Returns set of applied migration versions and names
 */
async function getAppliedMigrations(connection) {
  await ensureMigrationTable(connection);
  const [rows] = await connection.query('SELECT `version`, `name`, `applied_at` FROM `schema_migrations` ORDER BY `id` ASC');
  return {
    rows,
    namesSet: new Set(rows.map(r => r.name)),
    versionsSet: new Set(rows.map(r => r.version))
  };
}

/**
 * Splits SQL into individual executable statements, respecting quotes and delimiters
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inQuote = null;
  const lines = sql.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed.startsWith('#')) {
      continue;
    }

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if ((char === "'" || char === '"' || char === '`') && (i === 0 || line[i - 1] !== '\\')) {
        if (inQuote === char) inQuote = null;
        else if (!inQuote) inQuote = char;
      }
      if (char === ';' && !inQuote) {
        if (current.trim().length > 0) {
          statements.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }
    current += '\n';
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  return statements.filter(s => s.length > 0);
}

/**
 * Executes a single migration's SQL statements safely and idempotently
 */
async function executeMigrationSql(conn, sql, file) {
  const statements = splitSqlStatements(sql);

  for (let idx = 0; idx < statements.length; idx++) {
    const stmt = statements[idx];
    if (!stmt) continue;

    // Handle MariaDB "ALTER TABLE ... ADD COLUMN IF NOT EXISTS ..." with fallback for older MySQL
    const alterColMatch = stmt.match(/^ALTER\s+TABLE\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s+([\s\S]+)$/i);
    if (alterColMatch) {
      const tableName = alterColMatch[1];
      const columnName = alterColMatch[2];
      const colDef = alterColMatch[3];

      try {
        await conn.query(stmt);
      } catch (err) {
        if (err.message && (err.message.includes('IF NOT EXISTS') || err.errno === 1064)) {
          const [chk] = await conn.query(
            'SELECT COUNT(*) as count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
            [tableName, columnName]
          );
          if (chk && chk[0] && chk[0].count === 0) {
            await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${colDef}`);
          }
        } else if (err.errno === 1060 || (err.message && err.message.includes('Duplicate column name'))) {
          // Column already exists, safe to continue
        } else {
          throw err;
        }
      }
      continue;
    }

    // Handle MariaDB/MySQL "CREATE [UNIQUE] INDEX IF NOT EXISTS ..."
    const createIndexMatch = stmt.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s+ON\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s*\(([\s\S]+)\)$/i);
    if (createIndexMatch) {
      const isUnique = Boolean(createIndexMatch[1]);
      const indexName = createIndexMatch[2];
      const tableName = createIndexMatch[3];
      const colList = createIndexMatch[4];

      try {
        await conn.query(stmt);
      } catch (err) {
        if (err.errno === 1061 || (err.message && err.message.includes('Duplicate key name'))) {
          // Index already exists, safe to continue
        } else if (err.errno === 1064 || (err.message && err.message.includes('IF NOT EXISTS'))) {
          // Fallback for older MySQL lacking IF NOT EXISTS in CREATE INDEX
          const [chk] = await conn.query(
            'SELECT COUNT(*) as count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
            [tableName, indexName]
          );
          if (chk && chk[0] && chk[0].count === 0) {
            const createSql = `CREATE ${isUnique ? 'UNIQUE ' : ''}INDEX \`${indexName}\` ON \`${tableName}\` (${colList})`;
            try {
              await conn.query(createSql);
            } catch (createErr) {
              if (createErr.errno !== 1061) throw createErr;
            }
          }
        } else {
          throw err;
        }
      }
      continue;
    }

    // Default statement execution with defensive error code handling
    try {
      await conn.query(stmt);
    } catch (err) {
      // 1050: Table already exists, 1060: Duplicate column name, 1061: Duplicate key name, 1068: Multiple primary key
      if (err.errno === 1050 || err.errno === 1060 || err.errno === 1061 || err.errno === 1068) {
        continue;
      }
      // 1054: Unknown column (e.g., if settings table lacks setting_group/description column or legacy custom_orders lacks quoted_price)
      if (err.errno === 1054 && (/INSERT\s+INTO\s+[`"]?settings[`"]?/i.test(stmt) || /custom_orders/i.test(stmt))) {
        console.warn('[Migration Runner] Safe notice: optional column in data sync not present, skipping');
        continue;
      }
      // 1146: Table doesn't exist on legacy migration check (e.g. custom_orders for insert ignore copy)
      if (err.errno === 1146 && (/custom_orders/i.test(stmt) || /_migrations/i.test(stmt))) {
        console.log('[Migration Runner] Safe notice: legacy table referenced in data sync does not exist, continuing.');
        continue;
      }
      throw err;
    }
  }
}

/**
 * Touches tmp/restart.txt to gracefully notify Phusion Passenger on Hostinger
 */
function touchPassengerRestart() {
  try {
    const restartFile = path.resolve(__dirname, '..', 'tmp', 'restart.txt');
    const tmpDir = path.dirname(restartFile);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    fs.writeFileSync(restartFile, String(Date.now()));
  } catch (_) {}
}

const MIGRATION_REQUIRED_TABLES = {
  '001': 'designs',
  '004': 'activity_logs',
  '005': 'download_logs',
  '007': 'file_scan_results',
  '008': 'import_jobs',
  '009': 'email_campaigns',
  '014': 'price_update_logs',
  '017': 'stitch_update_logs',
  '021': 'design_files',
  '022': 'image_replace_logs',
  '024': 'design_images',
  '025': 'upload_sessions',
  '028': 'custom_requests',
  '031': 'bulk_replace_jobs',
  '032': 'bulk_replace_jobs',
  '038': 'custom_requests'
};

const MIGRATION_REQUIRED_COLUMNS = {
  '028': { table: 'custom_requests', column: 'request_number' },
  '029': { table: 'design_files', column: 'retired_at' },
  '030': { table: 'settings', column: 'setting_key' },
  '031': { table: 'design_files', column: 'retired_at' },
  '032': { table: 'image_replace_log_items', column: 'old_files_json' },
  '038': { table: 'custom_requests', column: 'request_number' }
};

const CANONICAL_REQUIRED_TABLES = [
  'users', 'categories', 'designs', 'design_images', 'design_files', 'design_file_variants',
  'orders', 'order_items', 'custom_requests', 'settings', 'banners',
  'coupons', 'reviews', 'wishlist', 'contact_messages', 'activity_logs',
  'download_logs', 'file_scan_results', 'import_jobs', 'email_campaigns',
  'price_update_logs', 'stitch_update_logs', 'image_replace_logs', 'upload_sessions',
  'bulk_replace_jobs', 'bulk_replace_job_items'
];

/**
 * Runs all pending numbered migrations in sequence with table presence verification
 */
async function runPendingMigrations({ connection: existingConn, silent = false, notifyPassenger = false } = {}) {
  const config = getDbConfig();
  let conn = existingConn;
  let shouldClose = false;
  const runStartTime = Date.now();
  currentMigrationState.state = 'migrating';
  currentMigrationState.error = null;

  try {
    if (!conn) {
      try {
        conn = await mysql.createConnection(config);
        shouldClose = true;
      } catch (connErr) {
        const errorDesc = formatErrorMessage(connErr);
        throw new Error(`Database connection failed (${errorDesc}). Verify DB_HOST, DB_USER, DB_NAME in environment.`);
      }
    }

    try {
      await conn.query('SET SESSION lock_wait_timeout = 10');
      await conn.query('SET SESSION wait_timeout = 30');
    } catch (_) {}

    await ensureMigrationTable(conn);
    const { namesSet, versionsSet } = await getAppliedMigrations(conn);
    const allFiles = getAvailableMigrationFiles();

    let dbServerVersion = 'Unknown';
    try {
      const [vRows] = await conn.query('SELECT VERSION() AS version');
      if (vRows && vRows[0]) dbServerVersion = vRows[0].version;
    } catch {}

    // Fetch all currently existing tables and columns to catch false-positive migration skips
    const [existingTableRows] = await conn.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()'
    );
    const existingTableNames = new Set(
      (existingTableRows || []).map(r => (r.TABLE_NAME || r.table_name || Object.values(r)[0]).toLowerCase())
    );

    const [existingColRows] = await conn.query(
      'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE()'
    );
    const existingColumnKeys = new Set(
      (existingColRows || []).map(r => `${(r.TABLE_NAME || r.table_name || '').toLowerCase()}.${(r.COLUMN_NAME || r.column_name || '').toLowerCase()}`)
    );

    if (!silent) {
      console.log('====================================================');
      console.log(' 🌸 Aruvi Embroidery — Automated Database Migrations');
      console.log(` 🐬 DB Server Version: ${dbServerVersion} (Charset: utf8mb4)`);
      console.log(` 📂 Total numbered migration files detected: ${allFiles.length}`);
      console.log(` 📊 Existing database tables verified: ${existingTableNames.size}`);
      console.log('====================================================');
    }

    const appliedThisRun = [];
    const failedThisRun = [];

    for (const file of allFiles) {
      const version = file.split('_')[0];
      const expectedTable = MIGRATION_REQUIRED_TABLES[version];
      const expectedCol = MIGRATION_REQUIRED_COLUMNS[version];

      let tableActuallyExists = true;
      if (expectedTable && !existingTableNames.has(expectedTable.toLowerCase())) {
        tableActuallyExists = false;
      }

      let colActuallyExists = true;
      if (expectedCol) {
        const key = `${expectedCol.table.toLowerCase()}.${expectedCol.column.toLowerCase()}`;
        if (!existingColumnKeys.has(key)) {
          colActuallyExists = false;
        }
      }

      // If recorded as applied but the required table or column is missing, purge stale record & re-run
      if ((!tableActuallyExists || !colActuallyExists) && (namesSet.has(file) || versionsSet.has(version))) {
        const missingDesc = !tableActuallyExists ? `table "${expectedTable}"` : `column "${expectedCol.table}.${expectedCol.column}"`;
        if (!silent) console.warn(`  ⚠️ [SCHEMA SYNC] Migration ${file} was recorded in schema_migrations but ${missingDesc} is missing. Purging stale record and re-running...`);
        try {
          await conn.query('DELETE FROM `schema_migrations` WHERE `version` = ? OR `name` = ?', [version, file]);
          namesSet.delete(file);
          versionsSet.delete(version);
        } catch (_) {}
      }

      const isApplied = (namesSet.has(file) || versionsSet.has(version)) && tableActuallyExists && colActuallyExists;

      if (isApplied) {
        if (!silent) console.log(`  [SKIPPED] ${file} (already applied)`);
        continue;
      }

      if (!silent) console.log(`  [APPLYING] ${file}...`);

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Execute DDL statements directly without transaction wrapping
      // (MySQL/MariaDB implicitly commits transactions on DDL statements)
      try {
        await executeMigrationSql(conn, sql, file);

        // Record in schema_migrations
        await conn.query(
          'INSERT IGNORE INTO `schema_migrations` (`version`, `name`) VALUES (?, ?)',
          [version, file]
        );

        appliedThisRun.push(file);
        if (expectedTable) existingTableNames.add(expectedTable.toLowerCase());
        console.log(`Applied migration ${version}`);
      } catch (fileErr) {
        const cleanMsg = formatErrorMessage(fileErr);
        console.error(`FAILED ${version}: ${cleanMsg}`);
        failedThisRun.push({
          file,
          version,
          error: cleanMsg,
          sqlState: fileErr.sqlState || 'N/A'
        });
      }
    }

    if (notifyPassenger && appliedThisRun.length > 0) {
      touchPassengerRestart();
    }

    currentMigrationState.state = failedThisRun.length > 0 ? 'degraded' : 'ready';
    currentMigrationState.pendingCount = 0;
    currentMigrationState.appliedCount = appliedThisRun.length;
    currentMigrationState.failedCount = failedThisRun.length;
    currentMigrationState.durationMs = Date.now() - runStartTime;
    currentMigrationState.lastRunAt = new Date().toISOString();

    // Post-migration table presence audit
    const missingTables = [];
    for (const tName of CANONICAL_REQUIRED_TABLES) {
      const [recheck] = await conn.query(
        'SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [tName]
      );
      if (!recheck || !recheck[0] || recheck[0].count === 0) {
        missingTables.push(tName);
      }
    }

    if (!silent) {
      console.log('====================================================');
      if (failedThisRun.length > 0) {
        console.warn(` ⚠️ Migrations completed with ${failedThisRun.length} warning(s)/failure(s). Run manual sync via phpMyAdmin if needed.`);
      } else if (appliedThisRun.length === 0) {
        console.log(' ✨ Database schema is up to date. Zero pending migrations.');
      } else {
        console.log(` ✨ Successfully applied ${appliedThisRun.length} pending migration(s) in ${currentMigrationState.durationMs}ms.`);
      }

      if (missingTables.length > 0) {
        console.warn(` ⚠️ [WARNING] Detected ${missingTables.length} missing table(s): ${missingTables.join(', ')}`);
        console.warn('    Import migrations/production_sync.sql in phpMyAdmin to complete synchronization.');
      } else {
        console.log(' ✓ All canonical database tables verified present.');
      }
      console.log('====================================================');
    }

    return {
      success: failedThisRun.length === 0 && missingTables.length === 0,
      appliedCount: appliedThisRun.length,
      appliedFiles: appliedThisRun,
      failedCount: failedThisRun.length,
      failedFiles: failedThisRun,
      missingTables,
      durationMs: currentMigrationState.durationMs,
      dbServerVersion
    };

  } catch (outerErr) {
    const cleanOuterMsg = formatErrorMessage(outerErr);
    currentMigrationState.state = 'degraded';
    currentMigrationState.error = cleanOuterMsg;
    currentMigrationState.durationMs = Date.now() - runStartTime;
    currentMigrationState.lastRunAt = new Date().toISOString();
    console.error('❌ [Migration Runner Safe Catch]:', cleanOuterMsg);
    return {
      success: false,
      appliedCount: 0,
      appliedFiles: [],
      failedCount: 1,
      failedFiles: [{ file: 'connection', version: 'all', error: cleanOuterMsg }],
      missingTables: [],
      error: cleanOuterMsg,
      durationMs: currentMigrationState.durationMs,
      dbServerVersion: 'Unknown'
    };
  } finally {
    if (shouldClose && conn) {
      try {
        await conn.end();
      } catch {}
    }
  }
}

/**
 * Returns detailed status of all migrations (for Admin System Health dashboard)
 */
async function getMigrationStatus() {
  const config = getDbConfig();
  let conn = null;

  try {
    conn = await mysql.createConnection(config);
    await ensureMigrationTable(conn);
    const { rows, namesSet, versionsSet } = await getAppliedMigrations(conn);
    const allFiles = getAvailableMigrationFiles();

    // Fetch all currently existing tables and columns to catch false-positive migration status
    let existingTableNames = new Set();
    let existingColumnKeys = new Set();
    try {
      const [existingTableRows] = await conn.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()'
      );
      existingTableNames = new Set(
        (existingTableRows || []).map(r => (r.TABLE_NAME || r.table_name || Object.values(r)[0]).toLowerCase())
      );
      const [existingColRows] = await conn.query(
        'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE()'
      );
      existingColumnKeys = new Set(
        (existingColRows || []).map(r => `${(r.TABLE_NAME || r.table_name || '').toLowerCase()}.${(r.COLUMN_NAME || r.column_name || '').toLowerCase()}`)
      );
    } catch (_) {}

    const migrationsList = allFiles.map(file => {
      const version = file.split('_')[0];
      const appliedRow = rows.find(r => r.name === file || r.version === version);
      const expectedTable = MIGRATION_REQUIRED_TABLES[version];
      const expectedCol = MIGRATION_REQUIRED_COLUMNS[version];

      let tableExists = true;
      if (expectedTable && !existingTableNames.has(expectedTable.toLowerCase())) {
        tableExists = false;
      }

      let colExists = true;
      if (expectedCol) {
        const key = `${expectedCol.table.toLowerCase()}.${expectedCol.column.toLowerCase()}`;
        if (!existingColumnKeys.has(key)) {
          colExists = false;
        }
      }

      const isApplied = Boolean(appliedRow || namesSet.has(file) || versionsSet.has(version)) && tableExists && colExists;
      return {
        filename: file,
        file,
        version,
        isApplied,
        appliedAt: appliedRow ? appliedRow.applied_at : null
      };
    });

    const pendingCount = migrationsList.filter(m => !m.isApplied).length;

    return {
      total: allFiles.length,
      appliedCount: migrationsList.filter(m => m.isApplied).length,
      pendingCount,
      isUpToDate: pendingCount === 0,
      migrations: migrationsList
    };
  } catch (err) {
    return {
      total: 0,
      appliedCount: 0,
      pendingCount: 0,
      isUpToDate: false,
      error: formatErrorMessage(err),
      migrations: []
    };
  } finally {
    if (conn) {
      try { await conn.end(); } catch {}
    }
  }
}

module.exports = {
  runPendingMigrations,
  getMigrationStatus,
  getRunnerStatus,
  touchPassengerRestart,
  splitSqlStatements,
  getAvailableMigrationFiles,
  formatErrorMessage
};
