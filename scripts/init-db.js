const runMigrations = require('./migrate');
const runSeed = require('./seed');

async function initDatabase() {
  console.log('--- Initializing Aruvi Embroidery Database ---');
  try {
    // 1. Run migrations safely (CREATE TABLE IF NOT EXISTS, never drops data)
    await runMigrations();

    // NOTE: Demo/sample seed data is NEVER run on deploy or initialization.
    // If you explicitly want demo seed data, run manually: npm run seed:demo
    console.log('--- Database Migrations Finished Successfully ---');
  } catch (err) {
    console.error('❌ Database Initialization Failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  initDatabase();
}

module.exports = initDatabase;
