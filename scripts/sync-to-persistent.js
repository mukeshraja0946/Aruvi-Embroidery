const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const storage = require('../config/storage');

function copyRecursiveSync(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return { copied: 0, bytes: 0 };
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  let copied = 0;
  let bytes = 0;

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      const res = copyRecursiveSync(srcPath, destPath);
      copied += res.copied;
      bytes += res.bytes;
    } else {
      // Non-destructive: do not overwrite if destination exists and has same size
      let shouldCopy = true;
      if (fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (srcStat.size === destStat.size && srcStat.mtime <= destStat.mtime) {
          shouldCopy = false;
        }
      }

      if (shouldCopy) {
        fs.copyFileSync(srcPath, destPath);
        const stat = fs.statSync(destPath);
        copied++;
        bytes += stat.size;
      }
    }
  }

  return { copied, bytes };
}

async function syncUploads() {
  const targetDir = storage.getUploadsDir();
  const defaultDir = storage.defaultUploadsDir;

  console.log('==================================================');
  console.log('Aruvi Embroidery — Persistent Storage Synchronizer');
  console.log('==================================================');
  console.log(`Default Source:     ${defaultDir}`);
  console.log(`Persistent Target:  ${targetDir}`);

  if (path.resolve(targetDir) === path.resolve(defaultDir)) {
    console.log('\n[INFO] PERSISTENT_UPLOADS_DIR is currently pointing to the default project directory.');
    console.log('To store uploads outside the project repository, set PERSISTENT_UPLOADS_DIR in .env');
    console.log('Example: PERSISTENT_UPLOADS_DIR=/var/data/aruvi-uploads');
    return;
  }

  console.log('\nStarting non-destructive sync to persistent storage...');
  const result = copyRecursiveSync(defaultDir, targetDir);

  const mb = (result.bytes / (1024 * 1024)).toFixed(2);
  console.log(`\n✓ Sync Complete!`);
  console.log(`Files copied / verified: ${result.copied}`);
  console.log(`Data transferred:        ${mb} MB`);
  console.log(`Target location:         ${targetDir}`);
  console.log('==================================================');
}

syncUploads();
