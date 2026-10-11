const runMigrations = require('./migrate');
const runSeed = require('./seed');

async function initDatabase() {
  console.log('--- Initializing Aruvi Embroidery Database ---');
  try {
    // 1. Run migrations safely (CREATE TABLE IF NOT EXISTS, never drops data)
    await runMigrations();

    // 2. Run seed safely (only runs if database has no existing designs/users)
    await runSeed();

    console.log('--- Database Initialization / Verification Finished Successfully ---');
  } catch (err) {
    console.error('❌ Database Initialization Failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  initDatabase();
}

module.exports = initDatabase;
