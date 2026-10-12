const { runPendingMigrations } = require('../services/migrationRunner');

async function main() {
  try {
    const result = await runPendingMigrations({ silent: false });
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration Process Aborted:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = runPendingMigrations;
