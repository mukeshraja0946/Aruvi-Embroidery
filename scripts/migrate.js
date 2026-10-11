const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function runMigrations() {
  console.log('====================================================');
  console.log(' Aruvi Embroidery — Database Migration Runner');
  console.log('====================================================');

  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '3306');
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'aruvi_embroidery';

  let connection;
  try {
    // 1. Connect and ensure database exists
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      multipleStatements: true
    });

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database });

    console.log(`Connected to database: ${database} at ${host}:${port}`);

    // 2. Create _migrations tracking table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`_migrations\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL UNIQUE,
        \`applied_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Get already applied migrations
    const [appliedRows] = await connection.query('SELECT `name` FROM `_migrations` ORDER BY `id` ASC');
    const appliedSet = new Set(appliedRows.map(r => r.name));

    // 4. Find all numbered .sql migration files
    const migrationsDir = path.join(__dirname, '../migrations');
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (files.length === 0) {
      console.log('No migration files found in migrations/ directory.');
      return;
    }

    console.log(`Found ${files.length} migration file(s). Checking status...`);

    let appliedCount = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  [SKIPPED] ${file} (already applied)`);
        continue;
      }

      console.log(`  [APPLYING] ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      // Execute migration statements
      await connection.query(sqlContent);

      // Record migration
      await connection.query('INSERT INTO `_migrations` (`name`) VALUES (?)', [file]);
      console.log(`  [SUCCESS] ${file} applied successfully.`);
      appliedCount++;
    }

    console.log('====================================================');
    if (appliedCount === 0) {
      console.log('Database is up to date. No new migrations needed.');
    } else {
      console.log(`Successfully applied ${appliedCount} new migration(s).`);
    }
    console.log('====================================================');

  } catch (err) {
    console.error('❌ Migration Error:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
