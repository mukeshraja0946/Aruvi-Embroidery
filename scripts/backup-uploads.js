const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function backupUploads() {
  const uploadsDir = path.join(__dirname, '../public/uploads');
  const backupDir = path.join(__dirname, '../backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupZipPath = path.join(backupDir, `uploads_backup_${timestamp}.zip`);

  console.log(`Starting backup of uploads from: ${uploadsDir}`);
  const zip = new AdmZip();

  let fileCount = 0;
  function addFolder(dir, zipSub) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        addFolder(full, path.join(zipSub, item));
      } else {
        zip.addLocalFile(full, zipSub);
        fileCount++;
      }
    }
  }

  addFolder(uploadsDir, 'uploads');
  zip.writeZip(backupZipPath);

  const zipStat = fs.statSync(backupZipPath);
  console.log(`✓ Backup successfully created!`);
  console.log(`  Path: ${backupZipPath}`);
  console.log(`  Files included: ${fileCount}`);
  console.log(`  Archive size: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
}

backupUploads();
