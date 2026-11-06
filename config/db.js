const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

let pool = null;
let isConnected = false;
let initPromise = null;

let slowQueryCount = 0;
const QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS || '12000', 10);

let dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aruvi_embroidery',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '100', 10),
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
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
      // 1. Attempt server-level connection to ensure DB exists (Local development only)
      if (process.env.NODE_ENV !== 'production' && (dbConfig.host === 'localhost' || dbConfig.host === '127.0.0.1')) {
        try {
          const rootConn = await mysql.createConnection({
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            password: dbConfig.password,
            connectTimeout: 2000,
            multipleStatements: true,
            charset: 'utf8mb4'
          });
          await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
          await rootConn.end();
        } catch (dbCreateErr) {
          // Ignore if user has no DB create permission or database exists
        }
      }

      // 2. Create pool to target database
      pool = mysql.createPool(dbConfig);
      let connection = null;

      try {
        connection = await pool.getConnection();
        const [vRows] = await connection.query('SELECT VERSION() AS version');
        if (vRows && vRows[0]) {
          dbServerVersion = vRows[0].version;
        }
      } catch (vErr) {
        console.warn('[DB Config Warning] Unable to retrieve server version:', vErr.message);
      } finally {
        if (connection) {
          try { connection.release(); } catch (_) {}
        }
      }

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

const missingTableWarnings = new Map();

function logQueryError(error, sql) {
  if (error.errno === 1146 || error.code === 'ER_NO_SUCH_TABLE') {
    const tableMatch = error.message.match(/Table '([^']+)' doesn't exist/i);
    const tableName = tableMatch ? tableMatch[1] : 'unknown';
    const lastLogged = missingTableWarnings.get(tableName) || 0;
    const now = Date.now();
    if (now - lastLogged > 600000) { // Log rate-limited: at most once every 10 minutes as WARN
      missingTableWarnings.set(tableName, now);
      console.warn(`[DB Schema Warning] Table "${tableName}" does not exist in database. Feature operating in safe fallback mode. (Run "npm run migrate" or import migrations/production_sync.sql).`);
    }
    return;
  }
  console.error('[DB Query Error]:', error.message, 'SQL:', sql);
}

/**
 * Execute a query with a strict per-query timeout to prevent database locks from hanging the Node app
 */
async function executeWithTimeout(poolInstance, sql, params = [], timeoutMs = QUERY_TIMEOUT_MS) {
  const queryStart = Date.now();
  let timer = null;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`[DB Query Timeout] Query exceeded ${timeoutMs}ms limit: ${String(sql).slice(0, 100).replace(/\s+/g, ' ')}...`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, timeoutMs);
  });

  try {
    const queryPromise = poolInstance.query({ sql, timeout: timeoutMs }, params);
    const [rows] = await Promise.race([queryPromise, timeoutPromise]);
    const duration = Date.now() - queryStart;
    if (duration > 1000) {
      slowQueryCount++;
      console.warn(`[Slow Query Notice] SQL took ${duration}ms: ${String(sql).slice(0, 120).replace(/\s+/g, ' ')}`);
    }
    return rows;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute parameterized query
 */
async function query(sql, params = [], options = {}) {
  const customTimeout = options.timeout || QUERY_TIMEOUT_MS;
  if (initPromise) await initPromise;

  if (pool && isConnected) {
    try {
      return await executeWithTimeout(pool, sql, params, customTimeout);
    } catch (error) {
      error.sql = sql;
      error.params = params;
      logQueryError(error, sql);
      throw error;
    }
  } else {
    // Retry connection once
    try {
      initPromise = null;
      await initPool();
      if (pool && isConnected) {
        try {
          return await executeWithTimeout(pool, sql, params, customTimeout);
        } catch (error) {
          error.sql = sql;
          error.params = params;
          logQueryError(error, sql);
          throw error;
        }
      }
    } catch (e) {
      console.warn('[DB] Offline fallback mode active...');
    }
    return null;
  }
}

function getPoolStatus() {
  let activeConnections = 0;
  let idleConnections = 0;
  let queuedCount = 0;

  if (pool && pool.pool) {
    activeConnections = (pool.pool._allConnections ? pool.pool._allConnections.length : 0) -
                        (pool.pool._freeConnections ? pool.pool._freeConnections.length : 0);
    idleConnections = pool.pool._freeConnections ? pool.pool._freeConnections.length : 0;
    queuedCount = pool.pool._connectionQueue ? pool.pool._connectionQueue.length : 0;
  }

  return {
    connectionLimit: dbConfig.connectionLimit,
    queueLimit: dbConfig.queueLimit,
    activeConnections: Math.max(0, activeConnections),
    idleConnections: Math.max(0, idleConnections),
    queuedCount: Math.max(0, queuedCount),
    slowQueryCount,
    isConnected,
    dbServerVersion
  };
}

module.exports = {
  pool: () => pool,
  query,
  initPool,
  isConnected: () => isConnected,
  getPoolStatus,
  getSlowQueryCount: () => slowQueryCount,
  dbConfig
};

