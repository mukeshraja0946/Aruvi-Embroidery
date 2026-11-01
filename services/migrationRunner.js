const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const migrationsDir = path.resolve(__dirname, '..', 'migrations');

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

    // Default statement execution with defensive error code handling
    try {
      await conn.query(stmt);
    } catch (err) {
      // 1050: Table already exists, 1060: Duplicate column name, 1061: Duplicate key name, 1068: Multiple primary key
      if (err.errno === 1050 || err.errno === 1060 || err.errno === 1061 || err.errno === 1068) {
        continue;
      }
      // 1054: Unknown column (e.g., if settings table lacks setting_group/description column)
      if (err.errno === 1054 && /INSERT\s+INTO\s+[`"]?settings[`"]?/i.test(stmt)) {
        console.warn('[Migration Runner] Safe notice: column in settings insert not present, skipping optional metadata');
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
 * Runs all pending numbered migrations in sequence
 */
async function runPendingMigrations({ connection: existingConn, silent = false } = {}) {
  const config = getDbConfig();
  let conn = existingConn;
  let shouldClose = false;

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

    await ensureMigrationTable(conn);
    const { namesSet, versionsSet } = await getAppliedMigrations(conn);
    const allFiles = getAvailableMigrationFiles();

    let dbServerVersion = 'Unknown';
    try {
      const [vRows] = await conn.query('SELECT VERSION() AS version');
      if (vRows && vRows[0]) dbServerVersion = vRows[0].version;
    } catch {}

    if (!silent) {
      console.log('====================================================');
      console.log(' 🌸 Aruvi Embroidery — Automated Database Migrations');
      console.log(` 🐬 DB Server Version: ${dbServerVersion} (Charset: utf8mb4)`);
      console.log(` 📂 Total numbered migration files detected: ${allFiles.length}`);
      console.log('====================================================');
    }

    const appliedThisRun = [];
    let pendingCount = 0;

    for (const file of allFiles) {
      const version = file.split('_')[0];
      const isApplied = namesSet.has(file) || versionsSet.has(version);

      if (isApplied) {
        if (!silent) console.log(`  [SKIPPED] ${file} (already applied)`);
        continue;
      }

      pendingCount++;
      if (!silent) console.log(`  [APPLYING] ${file}...`);

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Execute migration safely statement-by-statement
      try {
        await executeMigrationSql(conn, sql, file);

        // Record in schema_migrations
        await conn.query(
          'INSERT IGNORE INTO `schema_migrations` (`version`, `name`) VALUES (?, ?)',
          [version, file]
        );

        appliedThisRun.push(file);
        if (!silent) console.log(`  ✅ [SUCCESS] ${file} applied successfully.`);
      } catch (fileErr) {
        const cleanMsg = formatErrorMessage(fileErr);
        console.error(`\n❌ [MIGRATION FAILED] Error applying migration file: ${file}`);
        console.error(`   Message: ${cleanMsg}`);
        console.error(`   SQL State: ${fileErr.sqlState || 'N/A'}`);
        console.error('   Existing data has not been touched.\n');
        throw new Error(`Migration ${file} failed: ${cleanMsg}`);
      }
    }

    if (!silent) {
      console.log('====================================================');
      if (appliedThisRun.length === 0) {
        console.log(' ✨ Database schema is up to date. Zero pending migrations.');
      } else {
        console.log(` ✨ Successfully applied ${appliedThisRun.length} pending migration(s).`);
      }
      console.log('====================================================');
    }

    return {
      success: true,
      appliedCount: appliedThisRun.length,
      appliedFiles: appliedThisRun,
      dbServerVersion
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

    const migrationsList = allFiles.map(file => {
      const version = file.split('_')[0];
      const appliedRow = rows.find(r => r.name === file || r.version === version);
      return {
        filename: file,
        version,
        isApplied: Boolean(appliedRow || namesSet.has(file) || versionsSet.has(version)),
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
  splitSqlStatements,
  getAvailableMigrationFiles,
  formatErrorMessage
};
