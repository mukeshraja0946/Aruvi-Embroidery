const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const db = require('../../config/db');
const storage = require('../../config/storage');
const healthCheckService = require('../../services/healthCheckService');
const { runBackup, backupsDir } = require('../../scripts/backup');
const Design = require('../../models/Design');
const ActivityLog = require('../../models/ActivityLog');

const projectRoot = path.resolve(__dirname, '../..');
const stagingBaseDir = path.join(projectRoot, 'scratch', 'relink_staging');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Normalizes text for matching SKU, title, or filename.
 * E.g., "AED-BLO-01" -> "aedblo01", "AED 2" -> "aed2"
 */
function normalizeKey(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Helper to match an extracted filename to existing database designs
 */
function matchFileToDesigns(fileName, designs) {
  const ext = path.extname(fileName).toLowerCase();
  const nameWithoutExt = path.basename(fileName, ext).trim();
  const normBase = normalizeKey(nameWithoutExt);

  // 1. Direct SKU match
  for (const d of designs) {
    if (d.sku && normalizeKey(d.sku) === normBase) {
      return { match: d, method: 'SKU Exact Match', confidence: 'High' };
    }
  }

  // 2. Direct Title match
  for (const d of designs) {
    if (d.title && normalizeKey(d.title) === normBase) {
      return { match: d, method: 'Design Title Match', confidence: 'High' };
    }
  }

  // 3. Match SKU contained in filename (e.g. "AED-BLO-01_front.jpg" -> "AED-BLO-01")
  for (const d of designs) {
    if (d.sku) {
      const normSku = normalizeKey(d.sku);
      if (normSku && normBase.startsWith(normSku)) {
        return { match: d, method: 'SKU Prefix Match', confidence: 'Medium' };
      }
    }
  }

  // 4. Match numeric design ID pattern (e.g., "AED 1" or "AED_1" or "design_1")
  const idMatch = normBase.match(/^(?:aed|design)?(\d+)$/i);
  if (idMatch && idMatch[1]) {
    const numId = parseInt(idMatch[1], 10);
    const byId = designs.find(d => d.id === numId);
    if (byId) {
      return { match: byId, method: 'Design ID Match', confidence: 'Medium' };
    }
  }

  return null;
}

// =========================================================================
// 1. MISSING FILES REPORT & CSV EXPORT
// =========================================================================

exports.getMissingFiles = async (req, res, next) => {
  try {
    const scan = await healthCheckService.runHealthScan();
    const filter = req.query.filter || 'all';

    let list = scan.missingDesigns || [];
    if (filter === 'missing_image') {
      list = list.filter(d => d.image_missing && !d.file_missing);
    } else if (filter === 'missing_file') {
      list = list.filter(d => d.file_missing && !d.image_missing);
    } else if (filter === 'missing_both') {
      list = list.filter(d => d.image_missing && d.file_missing);
    }

    res.render('admin/tools/missing-files', {
      title: 'Missing Files & Integrity Report - Admin',
      scan,
      designs: list,
      currentFilter: filter
    });
  } catch (err) {
    next(err);
  }
};

exports.exportMissingFilesCsv = async (req, res, next) => {
  try {
    const scan = await healthCheckService.runHealthScan();
    const list = scan.missingDesigns || [];

    const headers = ['Design ID', 'Title', 'SKU', 'Category', 'Price', 'Status', 'Image Status', 'Design File Status', 'Current Image Path', 'Current File Path'];
    const rows = [headers.join(',')];

    for (const d of list) {
      let statusStr = 'Active';
      if (!d.is_active) statusStr = 'Inactive/Draft';

      let imgStatus = d.image_missing ? 'MISSING' : 'OK';
      let fileStatus = d.file_missing ? 'MISSING' : 'OK';

      const row = [
        d.id,
        `"${(d.title || '').replace(/"/g, '""')}"`,
        `"${(d.sku || '').replace(/"/g, '""')}"`,
        `"${(d.category_name || '').replace(/"/g, '""')}"`,
        d.price || 0,
        statusStr,
        imgStatus,
        fileStatus,
        `"${(d.image_url || '').replace(/"/g, '""')}"`,
        `"${(d.file_path || '').replace(/"/g, '""')}"`
      ];
      rows.push(row.join(','));
    }

    const csvContent = rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="missing-files-report-${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
};

exports.replaceDesignFileQuick = async (req, res, next) => {
  try {
    const { designId, replaceType } = req.body;
    if (!designId || !req.file) {
      return res.status(400).json({ success: false, message: 'Missing design ID or uploaded file.' });
    }

    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();

    if (replaceType === 'image') {
      const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
      
      // Update primary image in design_images
      if (db.isConnected()) {
        await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [designId]);
        await db.query(
          'INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, 1, 0)',
          [designId, savedUrl]
        );
      }
      await ActivityLog.logFromReq(req, 'update', 'design', designId, `Replaced missing image for design #${designId}`);
      return res.json({ success: true, message: 'Product image successfully replaced!', newUrl: savedUrl });
    } else {
      // Machine File Replacement
      const savedPath = await storage.savePrivateFile(file.path, file.originalname, file.mimetype);
      const fmt = ext.replace('.', '').toUpperCase() || 'ZIP';

      if (db.isConnected()) {
        // Remove old non-preview files and insert new
        await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [designId]);
        await db.query(
          'INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview) VALUES (?, ?, ?, ?, ?, 0)',
          [designId, file.originalname, savedPath, fmt, file.size]
        );
        await db.query('UPDATE designs SET formats = ? WHERE id = ?', [fmt, designId]);
      }
      await ActivityLog.logFromReq(req, 'update', 'design', designId, `Replaced missing design file for design #${designId}`);
      return res.json({ success: true, message: 'Machine design file successfully replaced!', newPath: savedPath });
    }
  } catch (err) {
    console.error('replaceDesignFileQuick error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// =========================================================================
// 2. BULK IMAGE RELINK
// =========================================================================

exports.getBulkImageRelink = async (req, res, next) => {
  try {
    res.render('admin/tools/bulk-image-relink', {
      title: 'Bulk Image Relink Tool - Admin',
      preview: null
    });
  } catch (err) {
    next(err);
  }
};

exports.postBulkImageRelinkPreview = async (req, res, next) => {
  try {
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    const designs = db.isConnected() ? await db.query('SELECT id, title, sku, slug FROM designs ORDER BY id ASC') : [];

    const sessionId = crypto.randomBytes(8).toString('hex');
    const sessionStaging = path.join(stagingBaseDir, `img_${sessionId}`);
    ensureDir(sessionStaging);

    const extractedFiles = [];

    // Option A: ZIP Archive uploaded
    if (req.file) {
      const zipPath = req.file.path;
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryExt = path.extname(entry.entryName).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(entryExt)) {
          const safeName = path.basename(entry.entryName);
          const outPath = path.join(sessionStaging, safeName);
          fs.writeFileSync(outPath, entry.getData());
          extractedFiles.push({ filename: safeName, fullPath: outPath, size: entry.header.size });
        }
      }
    }
    // Option B: Folder path specified
    else if (req.body.folder_path && req.body.folder_path.trim()) {
      const folder = path.resolve(req.body.folder_path.trim());
      if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
        const files = fs.readdirSync(folder);
        for (const file of files) {
          const fExt = path.extname(file).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(fExt)) {
            const src = path.join(folder, file);
            const out = path.join(sessionStaging, file);
            fs.copyFileSync(src, out);
            extractedFiles.push({ filename: file, fullPath: out, size: fs.statSync(src).size });
          }
        }
      }
    }

    if (extractedFiles.length === 0) {
      const errMsg = 'No valid preview image files (.jpg, .png, .webp) found in the ZIP or folder.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('/admin/tools/bulk-image-relink');
    }

    // Match files to designs
    const matched = [];
    const unmatched = [];
    const duplicates = [];
    const matchedDesignIds = new Set();

    for (const item of extractedFiles) {
      const result = matchFileToDesigns(item.filename, designs);
      if (result) {
        if (matchedDesignIds.has(result.match.id)) {
          duplicates.push({
            filename: item.filename,
            design: result.match,
            method: result.method,
            reason: 'Multiple images found targeting this design SKU/Title'
          });
        } else {
          matchedDesignIds.add(result.match.id);
          matched.push({
            filename: item.filename,
            designId: result.match.id,
            designTitle: result.match.title,
            designSku: result.match.sku || `AED-${result.match.id}`,
            method: result.method,
            confidence: result.confidence
          });
        }
      } else {
        unmatched.push({
          filename: item.filename,
          size: item.size
        });
      }
    }

    // Save manifest in staging dir for commit step
    const manifestPath = path.join(sessionStaging, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ matched, sessionStaging }), 'utf8');

    const preview = {
      sessionId,
      totalExtracted: extractedFiles.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      duplicatesCount: duplicates.length,
      matched,
      unmatched,
      duplicates
    };

    if (isAjax) {
      return res.json({ success: true, preview });
    }

    res.render('admin/tools/bulk-image-relink', {
      title: 'Bulk Image Relink Preview - Admin',
      preview
    });
  } catch (err) {
    next(err);
  }
};

exports.postBulkImageRelinkCommit = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Invalid session ID for relink commit.' });
    }

    const sessionStaging = path.join(stagingBaseDir, `img_${sessionId}`);
    const manifestPath = path.join(sessionStaging, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ success: false, message: 'Relink staging session expired or not found. Please re-run preview.' });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const matched = manifest.matched || [];

    let successCount = 0;
    for (const item of matched) {
      const filePath = path.join(sessionStaging, item.filename);
      if (fs.existsSync(filePath)) {
        // Save to persistent storage
        const savedUrl = await storage.savePublicFile(filePath, item.filename);

        if (db.isConnected()) {
          // Set as primary image for design
          await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [item.designId]);
          await db.query(
            'INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, 1, 0)',
            [item.designId, savedUrl]
          );
        }
        successCount++;
      }
    }

    // Clean up staging session
    try {
      fs.rmSync(sessionStaging, { recursive: true, force: true });
    } catch (e) {}

    await ActivityLog.logFromReq(req, 'bulk_relink', 'design', null, `Bulk relinked ${successCount} images to products.`);

    const msg = `Successfully relinked ${successCount} product preview images to their matching designs!`;
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.json({ success: true, message: msg, relinkedCount: successCount });
    }

    req.flash('success', msg);
    res.redirect('/admin/tools/missing-files');
  } catch (err) {
    next(err);
  }
};

// =========================================================================
// 3. BULK MACHINE FILE RELINK
// =========================================================================

exports.getBulkFileRelink = async (req, res, next) => {
  try {
    res.render('admin/tools/bulk-file-relink', {
      title: 'Bulk Machine File Relink Tool - Admin',
      preview: null
    });
  } catch (err) {
    next(err);
  }
};

exports.postBulkFileRelinkPreview = async (req, res, next) => {
  try {
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    const designs = db.isConnected() ? await db.query('SELECT id, title, sku, slug FROM designs ORDER BY id ASC') : [];

    const sessionId = crypto.randomBytes(8).toString('hex');
    const sessionStaging = path.join(stagingBaseDir, `file_${sessionId}`);
    ensureDir(sessionStaging);

    const extractedFiles = [];
    const validMachineExts = ['.dst', '.pes', '.jef', '.exp', '.zip', '.rar'];

    if (req.file) {
      const zipPath = req.file.path;
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryExt = path.extname(entry.entryName).toLowerCase();
        if (validMachineExts.includes(entryExt)) {
          const safeName = path.basename(entry.entryName);
          const outPath = path.join(sessionStaging, safeName);
          fs.writeFileSync(outPath, entry.getData());
          extractedFiles.push({ filename: safeName, fullPath: outPath, size: entry.header.size, ext: entryExt });
        }
      }
    } else if (req.body.folder_path && req.body.folder_path.trim()) {
      const folder = path.resolve(req.body.folder_path.trim());
      if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
        const files = fs.readdirSync(folder);
        for (const file of files) {
          const fExt = path.extname(file).toLowerCase();
          if (validMachineExts.includes(fExt)) {
            const src = path.join(folder, file);
            const out = path.join(sessionStaging, file);
            fs.copyFileSync(src, out);
            extractedFiles.push({ filename: file, fullPath: out, size: fs.statSync(src).size, ext: fExt });
          }
        }
      }
    }

    if (extractedFiles.length === 0) {
      const errMsg = 'No valid machine files (.dst, .pes, .jef, .exp, .zip) found in the ZIP or folder.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('/admin/tools/bulk-file-relink');
    }

    const matched = [];
    const unmatched = [];
    const duplicates = [];
    const matchedDesignIds = new Set();

    for (const item of extractedFiles) {
      const result = matchFileToDesigns(item.filename, designs);
      if (result) {
        if (matchedDesignIds.has(result.match.id)) {
          duplicates.push({
            filename: item.filename,
            design: result.match,
            method: result.method,
            reason: 'Multiple machine files found targeting this design'
          });
        } else {
          matchedDesignIds.add(result.match.id);
          matched.push({
            filename: item.filename,
            designId: result.match.id,
            designTitle: result.match.title,
            designSku: result.match.sku || `AED-${result.match.id}`,
            format: item.ext.replace('.', '').toUpperCase(),
            size: item.size,
            method: result.method,
            confidence: result.confidence
          });
        }
      } else {
        unmatched.push({
          filename: item.filename,
          size: item.size
        });
      }
    }

    const manifestPath = path.join(sessionStaging, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ matched, sessionStaging }), 'utf8');

    const preview = {
      sessionId,
      totalExtracted: extractedFiles.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      duplicatesCount: duplicates.length,
      matched,
      unmatched,
      duplicates
    };

    if (isAjax) {
      return res.json({ success: true, preview });
    }

    res.render('admin/tools/bulk-file-relink', {
      title: 'Bulk File Relink Preview - Admin',
      preview
    });
  } catch (err) {
    next(err);
  }
};

exports.postBulkFileRelinkCommit = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Invalid session ID for file relink commit.' });
    }

    const sessionStaging = path.join(stagingBaseDir, `file_${sessionId}`);
    const manifestPath = path.join(sessionStaging, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ success: false, message: 'Relink staging session expired or not found. Please re-run preview.' });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const matched = manifest.matched || [];

    let successCount = 0;
    for (const item of matched) {
      const filePath = path.join(sessionStaging, item.filename);
      if (fs.existsSync(filePath)) {
        // Save to private persistent storage
        const savedPath = await storage.savePrivateFile(filePath, item.filename);
        const fmt = item.format || 'ZIP';

        if (db.isConnected()) {
          // Replace existing machine file records for this design
          await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [item.designId]);
          await db.query(
            'INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview) VALUES (?, ?, ?, ?, ?, 0)',
            [item.designId, item.filename, savedPath, fmt, item.size || 0]
          );
          await db.query('UPDATE designs SET formats = ? WHERE id = ?', [fmt, item.designId]);
        }
        successCount++;
      }
    }

    try {
      fs.rmSync(sessionStaging, { recursive: true, force: true });
    } catch (e) {}

    await ActivityLog.logFromReq(req, 'bulk_file_relink', 'design', null, `Bulk relinked ${successCount} machine files to products.`);

    const msg = `Successfully relinked ${successCount} machine design files to their matching products!`;
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.json({ success: true, message: msg, relinkedCount: successCount });
    }

    req.flash('success', msg);
    res.redirect('/admin/tools/missing-files');
  } catch (err) {
    next(err);
  }
};

// =========================================================================
// 4. BACKUP & HEALTH DASHBOARD
// =========================================================================

exports.getBackupPage = async (req, res, next) => {
  try {
    ensureDir(backupsDir);
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.zip'))
      .map(f => {
        const full = path.join(backupsDir, f);
        const stat = fs.statSync(full);
        return {
          filename: f,
          sizeMb: (stat.size / (1024 * 1024)).toFixed(2),
          createdAt: stat.mtime
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const health = await healthCheckService.runHealthScan();

    res.render('admin/tools/backup', {
      title: 'Backups & Storage Health - Admin',
      backups: files,
      health,
      storageDriver: storage.getStorageDriver(),
      uploadsDir: storage.getUploadsDir()
    });
  } catch (err) {
    next(err);
  }
};

exports.postRunBackup = async (req, res, next) => {
  try {
    const result = await runBackup();
    await ActivityLog.logFromReq(req, 'backup', 'system', null, `Created manual system backup: ${result.filename}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.json({ success: true, message: 'Backup created successfully!', backup: result });
    }

    req.flash('success', `Backup archive "${result.filename}" (${result.sizeMb} MB) created successfully!`);
    res.redirect('/admin/tools/backup');
  } catch (err) {
    next(err);
  }
};

exports.downloadBackup = async (req, res, next) => {
  try {
    const filename = req.params.filename;
    // Security check to avoid path traversal
    const safeName = path.basename(filename);
    const targetPath = path.join(backupsDir, safeName);

    if (!fs.existsSync(targetPath)) {
      req.flash('error', 'Backup archive requested does not exist.');
      return res.redirect('/admin/tools/backup');
    }

    return res.download(targetPath, safeName);
  } catch (err) {
    next(err);
  }
};
