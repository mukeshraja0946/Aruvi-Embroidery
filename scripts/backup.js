const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const dotenv = require('dotenv');

dotenv.config();

const storage = require('../config/storage');
const db = require('../config/db');

const projectRoot = path.resolve(__dirname, '..');
const backupsDir = path.join(projectRoot, 'backups');

async function dumpDatabaseToSql(outputPath) {
  try {
    if (!db.isConnected()) {
      await db.initPool();
    }
  } catch (e) {
    console.warn('[BACKUP] db.initPool error:', e.message);
  }

  if (!db.isConnected()) {
    console.warn('[BACKUP] Database is not connected. Writing placeholder SQL.');
    fs.writeFileSync(outputPath, '-- Database was offline during backup.\n');
    return;
  }

  const lines = [];
  lines.push(`-- Aruvi Embroidery MySQL Database Backup`);
  lines.push(`-- Generated At: ${new Date().toISOString()}`);
  lines.push(`-- Database: ${process.env.DB_NAME || 'aruvi_embroidery'}`);
  lines.push(`SET FOREIGN_KEY_CHECKS = 0;\n`);

  // Get list of tables
  const tablesResult = await db.query('SHOW TABLES');
  const tableKey = Object.keys(tablesResult[0] || {})[0];
  const tables = tablesResult.map(r => r[tableKey]);

  for (const table of tables) {
    // 1. Table structure
    const createResult = await db.query(`SHOW CREATE TABLE \`${table}\``);
    if (createResult && createResult[0]) {
      lines.push(`DROP TABLE IF EXISTS \`${table}\`;`);
      lines.push(`${createResult[0]['Create Table']};\n`);
    }

    // 2. Table data
    const rows = await db.query(`SELECT * FROM \`${table}\``);
    if (rows && rows.length > 0) {
      for (const row of rows) {
        const columns = Object.keys(row).map(c => `\`${c}\``).join(', ');
        const values = Object.values(row).map(val => {
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 1 : 0;
          if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
          // Escape string
          const str = String(val).replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, (char) => {
            switch (char) {
              case '\0': return '\\0';
              case '\x08': return '\\b';
              case '\x09': return '\\t';
              case '\x1a': return '\\z';
              case '\n': return '\\n';
              case '\r': return '\\r';
              case '"':
              case "'":
              case '\\':
              case '%':
                return '\\' + char;
              default: return char;
            }
          });
          return `'${str}'`;
        }).join(', ');

        lines.push(`INSERT INTO \`${table}\` (${columns}) VALUES (${values});`);
      }
      lines.push('');
    }
  }

  lines.push(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

async function runBackup() {
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tempSqlFile = path.join(backupsDir, `dump_${timestamp}.sql`);
  const finalZipFile = path.join(backupsDir, `aruvi_backup_${timestamp}.zip`);

  console.log('====================================================');
  console.log(`🚀 Starting Full System Backup: ${timestamp}`);
  console.log('====================================================');

  try {
    // 1. Export database
    console.log('📦 1/3 Exporting MySQL Database...');
    await dumpDatabaseToSql(tempSqlFile);
    console.log(`   ✓ Database dumped: ${path.basename(tempSqlFile)}`);

    // 2. Package database + uploads folder into ZIP
    console.log('📦 2/3 Archiving uploads and database dump...');
    const zip = new AdmZip();
    zip.addLocalFile(tempSqlFile, '', 'database.sql');

    // Archive previews
    const previewsDir = storage.getPreviewsDir();
    if (fs.existsSync(previewsDir)) {
      zip.addLocalFolder(previewsDir, 'uploads/previews');
    }

    // Archive designs
    const designsDir = storage.getDesignsDir();
    if (fs.existsSync(designsDir)) {
      zip.addLocalFolder(designsDir, 'uploads/designs');
    }

    // Archive brand assets
    const brandDir = path.join(projectRoot, 'public', 'assets', 'brand');
    if (fs.existsSync(brandDir)) {
      zip.addLocalFolder(brandDir, 'brand_assets');
    }

    zip.writeZip(finalZipFile);
    console.log(`   ✓ Backup archive created: ${finalZipFile}`);

    // Remove temp sql file
    if (fs.existsSync(tempSqlFile)) {
      fs.unlinkSync(tempSqlFile);
    }

    // 3. Clean up backups older than 30 days
    console.log('📦 3/3 Pruning backups older than 30 days...');
    const files = fs.readdirSync(backupsDir);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    for (const file of files) {
      if (file.endsWith('.zip') || file.endsWith('.sql')) {
        const filePath = path.join(backupsDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < thirtyDaysAgo) {
          fs.unlinkSync(filePath);
          prunedCount++;
        }
      }
    }
    console.log(`   ✓ Pruned ${prunedCount} old backups.`);

    const archiveStats = fs.statSync(finalZipFile);
    const sizeMb = (archiveStats.size / (1024 * 1024)).toFixed(2);

    console.log('====================================================');
    console.log(`✅ Backup completed successfully!`);
    console.log(`   File: ${path.basename(finalZipFile)}`);
    console.log(`   Size: ${sizeMb} MB`);
    console.log(`   Location: ${finalZipFile}`);
    console.log('====================================================');

    return {
      success: true,
      filename: path.basename(finalZipFile),
      path: finalZipFile,
      sizeMb,
      timestamp
    };
  } catch (err) {
    console.error('❌ Backup failed:', err);
    if (fs.existsSync(tempSqlFile)) {
      try { fs.unlinkSync(tempSqlFile); } catch (e) {}
    }
    throw err;
  }
}

if (require.main === module) {
  runBackup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runBackup, backupsDir };
