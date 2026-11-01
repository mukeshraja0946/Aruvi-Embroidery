const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const dotenv = require('dotenv');

dotenv.config();

const storage = require('../config/storage');
const db = require('../config/db');

const projectRoot = path.resolve(__dirname, '..');

/**
 * Resolves safe persistent backup directory outside the deploy folder
 */
function getBackupDir() {
  const custom = process.env.BACKUP_DIR || process.env.BACKUPS_DIR;
  if (custom && custom.trim() !== '') {
    const customResolved = path.resolve(custom.trim());
    if (!fs.existsSync(customResolved)) {
      try { fs.mkdirSync(customResolved, { recursive: true }); } catch (_) {}
    }
    return customResolved;
  }

  // Hostinger persistent backup location outside repo and outside hbuilds
  const hostingerBackup = '/home/u101925264/aruvi-backups';
  try {
    if (!fs.existsSync(hostingerBackup)) {
      fs.mkdirSync(hostingerBackup, { recursive: true });
    }
    const testProbe = path.join(hostingerBackup, `.probe_${Date.now()}`);
    fs.writeFileSync(testProbe, 'ok');
    fs.unlinkSync(testProbe);
    return hostingerBackup;
  } catch (_) {}

  // Fallback inside project root (local dev)
  const localBackup = path.join(projectRoot, 'backups');
  if (!fs.existsSync(localBackup)) {
    try { fs.mkdirSync(localBackup, { recursive: true }); } catch (_) {}
  }
  return localBackup;
}

const backupsDir = getBackupDir();

/**
 * Pure Node.js MySQL Database Dumper (Works without mysqldump binary or root privileges)
 */
async function dumpDatabaseNode(outputPath) {
  try {
    if (!db.isConnected()) {
      await db.initPool();
    }
  } catch (e) {
    console.warn('[BACKUP] db.initPool notice:', e.message);
  }

  if (!db.isConnected()) {
    console.warn('[BACKUP] Database is not connected. Writing placeholder notice.');
    fs.writeFileSync(outputPath, '-- Database was offline during backup.\n');
    return;
  }

  const lines = [];
  lines.push(`-- Aruvi Embroidery MySQL Database Backup (Node.js Engine)`);
  lines.push(`-- Generated At: ${new Date().toISOString()}`);
  lines.push(`-- Database: ${process.env.DB_NAME || 'aruvi_embroidery'}`);
  lines.push(`SET FOREIGN_KEY_CHECKS = 0;\n`);

  // Get list of tables
  const tablesResult = await db.query('SHOW TABLES');
  const tableKey = Object.keys(tablesResult[0] || {})[0];
  const tables = (tablesResult || []).map(r => r[tableKey]).filter(Boolean);

  for (const table of tables) {
    // 1. Table structure
    const createResult = await db.query(`SHOW CREATE TABLE \`${table}\``);
    if (createResult && createResult[0]) {
      lines.push(`DROP TABLE IF EXISTS \`${table}\`;`);
      lines.push(`${createResult[0]['Create Table']};\n`);
    }

    // 2. Table data in batches
    const countResult = await db.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    const totalRows = countResult[0]?.total || 0;
    const batchSize = 200;

    for (let offset = 0; offset < totalRows; offset += batchSize) {
      const rows = await db.query(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [batchSize, offset]);
      if (rows && rows.length > 0) {
        for (const row of rows) {
          const columns = Object.keys(row).map(c => `\`${c}\``).join(', ');
          const values = Object.values(row).map(val => {
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return val;
            if (typeof val === 'boolean') return val ? 1 : 0;
            if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
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
      }
    }
    lines.push('');
  }

  lines.push(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

/**
 * Attempts mysqldump first if available, falls back to Node.js dump
 */
async function dumpDatabaseToSql(outputPath) {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '3306';
  const user = process.env.DB_USER || 'root';
  const pass = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'aruvi_embroidery';

  const tryMysqldump = () => new Promise((resolve, reject) => {
    const passArg = pass ? `-p"${pass.replace(/"/g, '\\"')}"` : '';
    const cmd = `mysqldump -h ${host} -P ${port} -u ${user} ${passArg} --single-transaction --quick --skip-lock-tables ${dbName} > "${outputPath}"`;
    exec(cmd, { timeout: 30000 }, (error) => {
      if (error) return reject(error);
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100) {
        return resolve();
      }
      reject(new Error('mysqldump created empty file'));
    });
  });

  try {
    await tryMysqldump();
    console.log('   ✓ mysqldump binary executed successfully');
  } catch (_) {
    console.log('   ℹ mysqldump binary unavailable or failed; using Node.js pure SQL dumper');
    await dumpDatabaseNode(outputPath);
  }
}

async function runBackup() {
  const activeBackupsDir = getBackupDir();
  if (!fs.existsSync(activeBackupsDir)) {
    fs.mkdirSync(activeBackupsDir, { recursive: true });
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tempSqlFile = path.join(activeBackupsDir, `dump_${timestamp}.sql`);
  const finalZipFile = path.join(activeBackupsDir, `aruvi_backup_${timestamp}.zip`);

  console.log('====================================================');
  console.log(`🚀 Starting Full System Backup: ${timestamp}`);
  console.log(`📂 Backup Destination: ${activeBackupsDir}`);
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

    // Archive public uploads
    const publicDir = storage.getPublicDir();
    if (fs.existsSync(publicDir)) {
      zip.addLocalFolder(publicDir, 'uploads/public');
    }

    // Archive private uploads (machine files, originals, custom requests)
    const privateDir = storage.getPrivateDir();
    if (fs.existsSync(privateDir)) {
      // Exclude existing backups subfolder from being archived recursively inside itself
      try {
        const privateEntries = fs.readdirSync(privateDir, { withFileTypes: true });
        for (const entry of privateEntries) {
          if (entry.name === 'backups') continue;
          const entryPath = path.join(privateDir, entry.name);
          if (entry.isDirectory()) {
            zip.addLocalFolder(entryPath, `uploads/private/${entry.name}`);
          } else if (entry.isFile()) {
            zip.addLocalFile(entryPath, 'uploads/private');
          }
        }
      } catch (_) {}
    }

    // Archive committed brand assets fallback
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
    const files = fs.readdirSync(activeBackupsDir);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    for (const file of files) {
      if (file.endsWith('.zip') || file.endsWith('.sql')) {
        const filePath = path.join(activeBackupsDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < thirtyDaysAgo) {
            fs.unlinkSync(filePath);
            prunedCount++;
          }
        } catch (_) {}
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

/**
 * Returns list of existing backup files
 */
function getBackupsList() {
  const activeBackupsDir = getBackupDir();
  if (!fs.existsSync(activeBackupsDir)) return [];

  try {
    const files = fs.readdirSync(activeBackupsDir);
    return files
      .filter(f => f.endsWith('.zip'))
      .map(filename => {
        const filePath = path.join(activeBackupsDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          sizeMb: (stats.size / (1024 * 1024)).toFixed(2),
          createdAt: stats.birthtime || stats.mtime,
          path: filePath
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (_) {
    return [];
  }
}

/**
 * Restores database from a backup ZIP archive
 */
async function restoreFromZip(zipFilename) {
  const activeBackupsDir = getBackupDir();
  const safeFilename = path.basename(zipFilename);
  const zipPath = path.join(activeBackupsDir, safeFilename);

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Backup file not found: ${safeFilename}`);
  }

  const zip = new AdmZip(zipPath);
  const dbEntry = zip.getEntry('database.sql');
  if (!dbEntry) {
    throw new Error('No database.sql found inside backup ZIP');
  }

  const sqlContent = zip.readAsText(dbEntry);

  if (!db.isConnected()) {
    await db.initPool();
  }

  const { splitSqlStatements } = require('../services/migrationRunner');
  const statements = typeof splitSqlStatements === 'function'
    ? splitSqlStatements(sqlContent)
    : sqlContent.split(';\n').map(s => s.trim()).filter(Boolean);

  let executed = 0;
  for (const stmt of statements) {
    if (!stmt) continue;
    try {
      await db.query(stmt);
      executed++;
    } catch (err) {
      console.warn('[Restore Warning]: Statement error:', err.message);
    }
  }

  return { success: true, executedStatements: executed, filename: safeFilename };
}

if (require.main === module) {
  runBackup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  runBackup,
  getBackupsList,
  restoreFromZip,
  getBackupDir,
  backupsDir
};
