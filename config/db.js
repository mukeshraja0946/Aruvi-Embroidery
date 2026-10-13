const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

let pool = null;
let isConnected = false;
let initPromise = null;

let dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aruvi_embroidery',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
  charset: 'utf8mb4'
};

// Support cloud database connection strings (DATABASE_URL / MYSQL_URL / CLEARDB_DATABASE_URL)
const dbUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.CLEARDB_DATABASE_URL || process.env.JAWSDB_URL;
if (dbUrl) {
  try {
    const parsedUrl = new URL(dbUrl);
    dbConfig.host = parsedUrl.hostname || dbConfig.host;
    dbConfig.port = parsedUrl.port ? parseInt(parsedUrl.port) : dbConfig.port;
    dbConfig.user = decodeURIComponent(parsedUrl.username || dbConfig.user);
    dbConfig.password = decodeURIComponent(parsedUrl.password || dbConfig.password);
    dbConfig.database = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : dbConfig.database;
  } catch (urlErr) {
    console.warn('[DB Config Warning] Failed to parse DATABASE_URL string, falling back to individual DB_* vars:', urlErr.message);
  }
}

let dbServerVersion = 'Unknown';

async function initPool() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. Attempt server-level connection to ensure DB exists
      try {
        const rootConn = await mysql.createConnection({
          host: dbConfig.host,
          port: dbConfig.port,
          user: dbConfig.user,
          password: dbConfig.password,
          multipleStatements: true,
          charset: 'utf8mb4'
        });
        await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
        await rootConn.end();
      } catch (dbCreateErr) {
        // Ignore if server user has no DB create permission or database exists
      }

      // 2. Create pool to target database
      pool = mysql.createPool(dbConfig);
      const connection = await pool.getConnection();

      try {
        const [vRows] = await connection.query('SELECT VERSION() AS version');
        if (vRows && vRows[0]) {
          dbServerVersion = vRows[0].version;
        }
      } catch (vErr) {
        console.warn('[DB Config Warning] Unable to retrieve server version:', vErr.message);
      }

      connection.release();

      // Database safety: Never auto-run schema.sql, seed.sql, TRUNCATE, or DROP on startup.
      // Migrations are run safely via `npm run migrate` and seed runs only manually via `npm run seed`.

      isConnected = true;
      console.log(`==================================================\nDATABASE CONNECTION:\nHost: ${dbConfig.host}\nPort: ${dbConfig.port}\nDatabase: ${dbConfig.database}\nUser: ${dbConfig.user}\nDB Server Version: ${dbServerVersion}\nCharset: utf8mb4\nStatus: Connected\n==================================================`);
    } catch (err) {
      console.log(`==================================================\nDATABASE CONNECTION:\nHost: ${dbConfig.host}\nPort: ${dbConfig.port}\nDatabase: ${dbConfig.database}\nUser: ${dbConfig.user}\nStatus: Offline (Operating in Local Fallback Mode)\nError: ${err.message}\n==================================================`);
      isConnected = false;
    }
  })();

  return initPromise;
}

// Initial attempt
initPool();

/**
 * Execute parameterized query
 */
async function query(sql, params = []) {
  if (initPromise) await initPromise;

  if (pool && isConnected) {
    try {
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (error) {
      error.sql = sql;
      error.params = params;
      console.error('[DB Query Error]:', error.message, 'SQL:', sql);
      throw error;
    }
  } else {
    // Retry connection once
    try {
      initPromise = null;
      await initPool();
      if (pool && isConnected) {
        try {
          const [rows] = await pool.query(sql, params);
          return rows;
        } catch (error) {
          error.sql = sql;
          error.params = params;
          console.error('[DB Query Error]:', error.message, 'SQL:', sql);
          throw error;
        }
      }
    } catch (e) {
      console.warn('[DB] Offline fallback mode active...');
    }
    return null;
  }
}

module.exports = {
  pool: () => pool,
  query,
  initPool,
  isConnected: () => isConnected,
  dbConfig
};

