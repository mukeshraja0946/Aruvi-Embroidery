const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function runSeed() {
  console.log('====================================================');
  console.log(' Aruvi Embroidery — Safe Database Seed Runner');
  console.log('====================================================');

  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '3306');
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'aruvi_embroidery';

  let connection;
  try {
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      multipleStatements: true
    });

    console.log(`Connected to database: ${database} at ${host}:${port}`);

    // Check if tables exist
    const [tables] = await connection.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = ? AND table_name IN ('designs', 'users')
    `, [database]);

    const tableNames = tables.map(t => t.table_name || t.TABLE_NAME);

    if (tableNames.includes('designs') && tableNames.includes('users')) {
      // Check existing record count
      const [[{ count: designCount }]] = await connection.query('SELECT COUNT(*) AS count FROM `designs`');
      const [[{ count: userCount }]] = await connection.query('SELECT COUNT(*) AS count FROM `users`');

      console.log(`Current record counts -> Designs: ${designCount}, Users: ${userCount}`);

      if (designCount > 0 || userCount > 0) {
        console.log('----------------------------------------------------');
        console.log('ℹ️ [SAFEGUARD TRIGGERED] Database already contains existing data.');
        console.log(`   - Existing Designs: ${designCount}`);
        console.log(`   - Existing Users: ${userCount}`);
        console.log('   Skipping seed.sql to guarantee uploaded products & admin data are never overwritten.');
        console.log('----------------------------------------------------');
        return;
      }
    }

    const seedFile = path.join(__dirname, '../seed.sql');
    if (!fs.existsSync(seedFile)) {
      console.error('❌ seed.sql file not found at:', seedFile);
      process.exit(1);
    }

    console.log('Database is empty. Applying seed.sql for initial setup...');
    const seedSql = fs.readFileSync(seedFile, 'utf8');
    await connection.query(seedSql);

    console.log('✓ [SUCCESS] Initial seed data inserted successfully.');
    console.log('====================================================');

  } catch (err) {
    console.error('❌ Seeding Error:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = runSeed;
