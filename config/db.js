const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

let pool = null;
let isConnected = false;
let initPromise = null;

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aruvi_embroidery',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true
};

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
          multipleStatements: true
        });
        await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
        await rootConn.end();
      } catch (dbCreateErr) {
        // Ignore if server user has no DB create permission or database exists
      }

      // 2. Create pool to target database
      pool = mysql.createPool(dbConfig);
      const connection = await pool.getConnection();
      connection.release();

      // 3. Auto-initialize tables if empty
      try {
        const [tables] = await pool.query("SHOW TABLES LIKE 'designs'");
        if (!tables || tables.length === 0) {
          console.log(`[DB] Database '${dbConfig.database}' is empty. Running automatic schema & seed initialization...`);
          const schemaPath = path.join(__dirname, '../schema.sql');
          const seedPath = path.join(__dirname, '../seed.sql');
          if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await pool.query(schemaSql);
          }
          if (fs.existsSync(seedPath)) {
            const seedSql = fs.readFileSync(seedPath, 'utf8');
            await pool.query(seedSql);
          }
          console.log(`[DB] Schema & Seed initialization completed successfully.`);
        } else {
          // Auto-migrate orders table columns for Cashfree if missing
          try {
            const [cols] = await pool.query("SHOW COLUMNS FROM orders LIKE 'cashfree_order_id'");
            if (!cols || cols.length === 0) {
              await pool.query("ALTER TABLE orders ADD COLUMN payment_gateway VARCHAR(50) DEFAULT 'cashfree', ADD COLUMN cashfree_order_id VARCHAR(100) DEFAULT NULL, ADD COLUMN cashfree_payment_id VARCHAR(100) DEFAULT NULL;");
              console.log("[DB Migration] Added Cashfree columns (payment_gateway, cashfree_order_id, cashfree_payment_id) to orders table.");
            }
          } catch (colErr) {
            // Ignore if orders table check fails
          }
        }
      } catch (initErr) {
        console.warn(`[DB Init Warning]: ${initErr.message}`);
      }

      isConnected = true;
      console.log(`[DB] Connected successfully to MySQL database: ${dbConfig.database} on ${dbConfig.host}:${dbConfig.port}`);
    } catch (err) {
      console.warn(`[DB Warning] Could not establish connection to MySQL database '${dbConfig.database}'.`);
      console.warn(`[DB Warning] Reason: ${err.message}`);
      console.warn(`[DB Warning] Operating in fallback mode until MySQL server is active.`);
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
      console.error('[DB Query Error]:', error.message, 'SQL:', sql);
      throw error;
    }
  } else {
    // Retry connection once
    try {
      initPromise = null;
      await initPool();
      if (pool && isConnected) {
        const [rows] = await pool.query(sql, params);
        return rows;
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

