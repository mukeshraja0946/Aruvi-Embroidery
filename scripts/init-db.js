const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

async function initDatabase() {
  console.log('--- Initializing Aruvi Embroidery MySQL Database ---');
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '3306');
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'aruvi_embroidery';

  try {
    // 1. Connect without selecting database to create it
    const connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      multipleStatements: true
    });

    console.log(`Connected to MySQL server at ${host}:${port}`);

    // 2. Read schema.sql and seed.sql
    const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    const seedSql = fs.readFileSync(path.join(__dirname, '../seed.sql'), 'utf8');

    console.log(`Executing schema.sql on database '${dbName}'...`);
    await connection.query(schemaSql);
    console.log('✓ Database schema created / verified successfully.');

    console.log(`Executing seed.sql on database '${dbName}'...`);
    await connection.query(seedSql);
    console.log('✓ Seed data inserted successfully.');

    await connection.end();
    console.log('--- Database Initialization Complete! ---');
  } catch (err) {
    console.error('❌ Database Initialization Failed:');
    console.error(err.message);
    console.log('\nPlease ensure MySQL is running and credentials in .env are correct.');
  }
}

initDatabase();
