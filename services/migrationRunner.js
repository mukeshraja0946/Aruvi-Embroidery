const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const migrationsDir = path.resolve(__dirname, '..', 'migrations');

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
      console.warn('[Migration Config Warning] Failed to parse DATABASE_URL string:', urlErr.message);
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
  const [legacyCheck] = await connection.query(`
    SELECT COUNT(*) AS count 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE() AND table_name = '_migrations'
  `);

  if (legacyCheck && legacyCheck[0] && legacyCheck[0].count > 0) {
    try {
      await connection.query(`
        INSERT IGNORE INTO \`schema_migrations\` (\`version\`, \`name\`, \`applied_at\`)
        SELECT 
          SUBSTRING_INDEX(\`name\`, '_', 1) AS \`version\`,
          \`name\`,
          \`applied_at\`
        FROM \`_migrations\`
      `);
    } catch (legacyCopyErr) {
      console.warn('[Migration Runner] Note on legacy _migrations sync:', legacyCopyErr.message);
    }
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
 * Runs all pending numbered migrations in sequence
 */
async function runPendingMigrations({ connection: existingConn, silent = false } = {}) {
  const config = getDbConfig();
  let conn = existingConn;
  let shouldClose = false;

  try {
    if (!conn) {
      conn = await mysql.createConnection(config);
      shouldClose = true;
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

      // Execute migration
      try {
        await conn.query(sql);

        // Record in schema_migrations
        await conn.query(
          'INSERT INTO `schema_migrations` (`version`, `name`) VALUES (?, ?)',
          [version, file]
        );

        appliedThisRun.push(file);
        if (!silent) console.log(`  ✅ [SUCCESS] ${file} applied successfully.`);
      } catch (fileErr) {
        console.error(`\n❌ [MIGRATION FAILED] Error applying migration file: ${file}`);
        console.error(`   Message: ${fileErr.message}`);
        console.error(`   SQL State: ${fileErr.sqlState || 'N/A'}`);
        console.error('   Existing data has not been touched.\n');
        throw new Error(`Migration ${file} failed: ${fileErr.message}`);
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
      appliedFiles: appliedThisRun
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
  let conn;
  try {
    conn = await mysql.createConnection(config);
    await ensureMigrationTable(conn);
    const { rows, namesSet, versionsSet } = await getAppliedMigrations(conn);
    const allFiles = getAvailableMigrationFiles();

    const statusList = allFiles.map(file => {
      const version = file.split('_')[0];
      const appliedRow = rows.find(r => r.name === file || r.version === version);
      return {
        file,
        version,
        isApplied: !!appliedRow,
        appliedAt: appliedRow ? appliedRow.applied_at : null
      };
    });

    const pending = statusList.filter(s => !s.isApplied);
    const applied = statusList.filter(s => s.isApplied);

    return {
      total: allFiles.length,
      appliedCount: applied.length,
      pendingCount: pending.length,
      isUpToDate: pending.length === 0,
      migrations: statusList,
      pending,
      applied
    };
  } catch (err) {
    console.error('[getMigrationStatus error]:', err.message);
    return {
      total: 0,
      appliedCount: 0,
      pendingCount: 0,
      isUpToDate: false,
      error: err.message,
      migrations: [],
      pending: [],
      applied: []
    };
  } finally {
    if (conn) {
      try { await conn.end(); } catch {}
    }
  }
}

module.exports = {
  getAvailableMigrationFiles,
  runPendingMigrations,
  getMigrationStatus,
  ensureMigrationTable,
  getAppliedMigrations
};
