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
const { checkSystemHealth, checkSchemaSafetyOnStartup } = require('../../services/schemaHealthService');
const { runPendingMigrations } = require('../../services/migrationRunner');
const bulkPriceService = require('../../services/bulkPriceService');
const bulkStitchService = require('../../services/bulkStitchService');

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
 * Supports SKU suffixes: e.g. AED-BLO-01.zip, AED-BLO-01_2.zip, AED-BLO-01-front.zip, AED-BLO-01 (3).png, AED-BLO-01_main
 */
function matchFileToDesigns(fileName, designs) {
  const ext = path.extname(fileName).toLowerCase();
  const rawBase = path.basename(fileName, ext).trim();
  const normBase = normalizeKey(rawBase);

  // Check if filename indicates a main preview
  const isMain = /(?:^|[_\-\s])main$/i.test(rawBase);

  // 1. Direct SKU exact match
  for (const d of designs) {
    if (d.sku && normalizeKey(d.sku) === normBase) {
      return { match: d, method: 'SKU Exact Match', confidence: 'High', isMain, suffix: '', label: d.sku };
    }
  }

  // 2. Direct Title exact match
  for (const d of designs) {
    if (d.title && normalizeKey(d.title) === normBase) {
      return { match: d, method: 'Design Title Match', confidence: 'High', isMain, suffix: '', label: d.title };
    }
  }

  // 3. Suffix match on SKU
  // Sort designs by SKU length descending so longer matching SKUs take precedence over substrings
  const sortedDesigns = [...designs].filter(d => Boolean(d.sku)).sort((a, b) => b.sku.length - a.sku.length);

  const matchedCandidates = [];
  for (const d of sortedDesigns) {
    const skuNorm = normalizeKey(d.sku);
    if (!skuNorm) continue;

    // Pattern A: SKU followed by separator (_, -, space, dot, parenthesis) and suffix
    const escapedSku = d.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedSku}[_\\-\\s\\.\\(]+([^)]+)\\)?$`, 'i');
    const m = rawBase.match(regex);
    if (m) {
      const suffix = m[1].trim();
      let label = suffix;
      if (/^\d+$/.test(suffix)) {
        label = `Part ${suffix}`;
      } else {
        label = suffix.replace(/[-_.]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
      matchedCandidates.push({
        match: d,
        method: 'SKU Suffix Match',
        confidence: 'High',
        isMain: isMain || /^main$/i.test(suffix),
        suffix,
        label
      });
      break;
    }

    // Pattern B: Normalized prefix match if separator was stripped or spaced
    if (normBase.startsWith(skuNorm) && normBase.length > skuNorm.length) {
      const remainder = normBase.slice(skuNorm.length);
      matchedCandidates.push({
        match: d,
        method: 'SKU Prefix Match',
        confidence: 'Medium',
        isMain,
        suffix: remainder,
        label: remainder.toUpperCase()
      });
      break;
    }
  }

  if (matchedCandidates.length === 1) {
    return matchedCandidates[0];
  } else if (matchedCandidates.length > 1) {
    return {
      isAmbiguous: true,
      candidates: matchedCandidates,
      method: 'Ambiguous Prefix Match',
      confidence: 'Low',
      isMain,
      label: rawBase
    };
  }

  // 4. Match numeric design ID pattern (e.g., "AED 1" or "AED_1" or "design_1")
  const idMatch = normBase.match(/^(?:aed|design)?(\d+)$/i);
  if (idMatch && idMatch[1]) {
    const numId = parseInt(idMatch[1], 10);
    const byId = designs.find(d => d.id === numId);
    if (byId) {
      return { match: byId, method: 'Design ID Match', confidence: 'Medium', isMain, suffix: '', label: byId.sku || `AED-${byId.id}` };
    }
  }

  return null;
}

// =========================================================================
// 1. MISSING FILES REPORT & CSV EXPORT
// =========================================================================

exports.getMissingFiles = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const filter = req.query.filter || 'all';
    const search = req.query.search || '';

    const { designs, pagination } = await healthCheckService.getPaginatedDesignsWithStatus({
      page,
      limit,
      filter,
      search
    });

    const summary = await healthCheckService.getScanSummary();

    res.render('admin/tools/missing-files', {
      title: 'Missing Files & Storage Diagnostics - Admin',
      designs,
      pagination,
      summary,
      currentFilter: filter,
      currentSearch: search,
      currentPage: page
    });
  } catch (err) {
    next(err);
  }
};

exports.triggerFullScan = async (req, res, next) => {
  try {
    const result = await healthCheckService.triggerBackgroundScan();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getScanStatus = async (req, res, next) => {
  try {
    const summary = await healthCheckService.getScanSummary();
    const progressPercent = summary.totalDesigns > 0
      ? Math.round((summary.scannedDesigns / summary.totalDesigns) * 100)
      : (summary.status === 'completed' ? 100 : 0);

    res.json({
      success: true,
      summary: {
        ...summary,
        progressPercent: Math.min(100, Math.max(0, progressPercent))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.exportMissingFilesCsv = async (req, res, next) => {
  try {
    if (!db.isConnected()) await db.initPool();

    let results = [];
    try {
      const [tableCheck] = await db.query("SHOW TABLES LIKE 'file_scan_results'");
      if (tableCheck) {
        results = await db.query(`
          SELECT * FROM file_scan_results 
          WHERE image_status != 'ok' OR file_status != 'ok'
          ORDER BY design_id DESC
        `);
      }
    } catch (e) {}

    // Dynamic scan fallback if background scan hasn't run yet
    if (!results || results.length === 0) {
      const rawDesigns = await db.query(`
        SELECT 
          d.id, d.title, d.sku, d.price, d.is_active,
          c.name AS category_name,
          (SELECT di.image_url FROM design_images di WHERE di.design_id = d.id ORDER BY di.is_primary DESC, di.id ASC LIMIT 1) AS image_url,
          (SELECT df.file_path FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id ASC LIMIT 1) AS file_path,
          (SELECT df.file_name FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id ASC LIMIT 1) AS file_name
        FROM designs d
        LEFT JOIN categories c ON d.category_id = c.id
        ORDER BY d.id DESC
      `);

      results = [];
      for (const r of rawDesigns) {
        const imgStatus = await healthCheckService.checkAssetStatus(r.image_url);
        const fileStatus = await healthCheckService.checkAssetStatus(r.file_path);
        if (imgStatus !== 'ok' || fileStatus !== 'ok') {
          results.push({
            design_id: r.id,
            sku: r.sku || `AED-${r.id}`,
            title: r.title || 'Untitled',
            category_name: r.category_name || 'Uncategorized',
            price: r.price || 0,
            is_active: r.is_active,
            image_status: imgStatus,
            image_url: r.image_url,
            file_status: fileStatus,
            file_name: r.file_name,
            file_path: r.file_path
          });
        }
      }
    }

    const headers = ['Design ID', 'SKU', 'Title', 'Category', 'Price', 'Status', 'Image Status', 'Image Path', 'Machine File Status', 'File Name', 'File Path'];
    const rows = [headers.join(',')];

    for (const d of results) {
      const row = [
        d.design_id || d.id,
        `"${String(d.sku || '').replace(/"/g, '""')}"`,
        `"${String(d.title || '').replace(/"/g, '""')}"`,
        `"${String(d.category_name || '').replace(/"/g, '""')}"`,
        d.price || 0,
        d.is_active ? 'Active' : 'Inactive/Draft',
        d.image_status === 'none' ? 'No Image Uploaded' : (d.image_status === 'missing' ? 'MISSING' : 'OK'),
        `"${String(d.image_url || '').replace(/"/g, '""')}"`,
        d.file_status === 'none' ? 'No File Uploaded' : (d.file_status === 'missing' ? 'MISSING' : 'OK'),
        `"${String(d.file_name || '').replace(/"/g, '""')}"`,
        `"${String(d.file_path || '').replace(/"/g, '""')}"`
      ];
      rows.push(row.join(','));
    }

    const csvContent = rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="missing-files-report-${Date.now()}.csv"`);
    return res.send(csvContent);
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

    // Match files to designs supporting multiple preview images per design
    const matched = [];
    const unmatched = [];
    const ambiguous = [];
    const duplicates = [];
    const seenFilenamesPerDesign = new Set();

    // Group items by design to determine which image is primary:
    // First image is primary unless a filename contains '_main'
    const designGroups = new Map();

    for (const item of extractedFiles) {
      const result = matchFileToDesigns(item.filename, designs);
      if (result) {
        if (result.isAmbiguous) {
          ambiguous.push({
            filename: item.filename,
            size: item.size,
            candidates: (result.candidates || []).map(c => c.match.sku || c.match.title).join(', '),
            method: result.method
          });
        } else {
          const dId = result.match.id;
          const dedupKey = `${dId}_${item.filename.toLowerCase()}`;
          if (seenFilenamesPerDesign.has(dedupKey)) {
            duplicates.push({
              filename: item.filename,
              design: result.match,
              reason: 'Exact duplicate filename already assigned to this design'
            });
            continue;
          }
          seenFilenamesPerDesign.add(dedupKey);

          if (!designGroups.has(dId)) {
            designGroups.set(dId, []);
          }
          designGroups.get(dId).push({
            filename: item.filename,
            designId: dId,
            designTitle: result.match.title,
            designSku: result.match.sku || `AED-${dId}`,
            size: item.size,
            method: result.method,
            confidence: result.confidence,
            isExplicitMain: Boolean(result.isMain)
          });
        }
      } else {
        unmatched.push({
          filename: item.filename,
          size: item.size
        });
      }
    }

    // Resolve primary image for each design group:
    // If any filename has '_main' or isExplicitMain, that one is primary. Otherwise, first is primary.
    for (const [dId, groupItems] of designGroups.entries()) {
      const mainIdx = groupItems.findIndex(it => it.isExplicitMain);
      const primaryIndex = mainIdx !== -1 ? mainIdx : 0;

      groupItems.forEach((it, idx) => {
        matched.push({
          ...it,
          isPrimary: idx === primaryIndex,
          displayOrder: idx
        });
      });
    }

    // Save manifest in staging dir for commit step
    const manifestPath = path.join(sessionStaging, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ matched, unmatched, ambiguous, sessionStaging }), 'utf8');

    const preview = {
      sessionId,
      totalExtracted: extractedFiles.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      ambiguousCount: ambiguous.length,
      duplicatesCount: duplicates.length,
      matched,
      unmatched,
      ambiguous,
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
    const { sessionId, mode } = req.body;
    const relinkMode = mode === 'replace' ? 'replace' : 'append';

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

    if (db.isConnected() && relinkMode === 'replace') {
      const affectedDesignIds = [...new Set(matched.map(m => m.designId))];
      for (const dId of affectedDesignIds) {
        await db.query('DELETE FROM design_images WHERE design_id = ?', [dId]);
        await db.query("DELETE FROM design_files WHERE design_id = ? AND file_kind = 'image'", [dId]);
      }
    }

    let successCount = 0;
    for (const item of matched) {
      const filePath = path.join(sessionStaging, item.filename);
      if (fs.existsSync(filePath)) {
        // Save to persistent public preview storage
        const ext = path.extname(item.filename).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
        const savedUrl = await storage.savePublicFile(filePath, item.filename, mimeType);
        const fileStat = fs.statSync(filePath);
        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

        if (db.isConnected()) {
          // If this image is primary, clear previous primary flags for the design
          if (item.isPrimary) {
            await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [item.designId]);
            await db.query("UPDATE design_files SET is_primary_preview = 0 WHERE design_id = ? AND file_kind = 'image'", [item.designId]);
          }

          // Insert into design_images
          await db.query(
            'INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)',
            [item.designId, savedUrl, item.isPrimary ? 1 : 0, item.displayOrder || 0]
          );

          // Also mirror in design_files for unified multi-file catalog
          await db.query(
            `INSERT INTO design_files 
              (design_id, file_kind, label, original_name, storage_key, mime_type, file_size, checksum_sha256, sort_order, is_primary_preview, file_name, file_path, file_format, is_preview) 
             VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              item.designId,
              item.isPrimary ? 'Main Preview' : 'Gallery Preview',
              item.filename,
              savedUrl,
              mimeType,
              fileStat.size,
              fileHash,
              item.displayOrder || 0,
              item.isPrimary ? 1 : 0,
              item.filename,
              savedUrl,
              ext.replace('.', '').toUpperCase(),
            ]
          );
        }
        successCount++;
      }
    }

    // Clean up staging session
    try {
      fs.rmSync(sessionStaging, { recursive: true, force: true });
    } catch (e) {}

    await ActivityLog.logFromReq(req, 'bulk_relink', 'design', null, `Bulk relinked ${successCount} images to products (Mode: ${relinkMode}).`);

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
    const shouldUnpackInnerZip = req.body.unpack_zip === '1' || req.body.unpack_zip === 'true' || req.body.unpack_zip === true;

    const sessionId = crypto.randomBytes(8).toString('hex');
    const sessionStaging = path.join(stagingBaseDir, `file_${sessionId}`);
    ensureDir(sessionStaging);

    const extractedFiles = [];
    const validMachineExts = ['.dst', '.pes', '.jef', '.exp', '.zip', '.rar'];
    const forbiddenExts = ['.exe', '.php', '.js', '.sh', '.bat', '.cmd', '.vbs', '.py'];

    function safeExtractBuffer(filename, buffer) {
      const ext = path.extname(filename).toLowerCase();
      if (forbiddenExts.includes(ext)) return;
      const safeName = path.basename(filename);
      const outPath = path.join(sessionStaging, safeName);
      fs.writeFileSync(outPath, buffer);
      extractedFiles.push({ filename: safeName, fullPath: outPath, size: buffer.length, ext });
    }

    if (req.file) {
      const zipPath = req.file.path;
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        if (entry.entryName.includes('..')) continue; // Zip-Slip guard
        const entryExt = path.extname(entry.entryName).toLowerCase();

        // If inner file is a ZIP and admin requested safe unpack into separate files:
        if (shouldUnpackInnerZip && entryExt === '.zip') {
          try {
            const innerZip = new AdmZip(entry.getData());
            const innerEntries = innerZip.getEntries();
            for (const inEntry of innerEntries) {
              if (inEntry.isDirectory) continue;
              if (inEntry.entryName.includes('..')) continue;
              const inExt = path.extname(inEntry.entryName).toLowerCase();
              if (validMachineExts.includes(inExt)) {
                safeExtractBuffer(inEntry.entryName, inEntry.getData());
              }
            }
          } catch (unpackErr) {
            console.warn(`[Bulk Relink] Inner ZIP unpack warning for ${entry.entryName}:`, unpackErr.message);
            // Fall back to keeping the archive itself
            safeExtractBuffer(entry.entryName, entry.getData());
          }
        } else if (validMachineExts.includes(entryExt)) {
          safeExtractBuffer(entry.entryName, entry.getData());
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
            if (shouldUnpackInnerZip && fExt === '.zip') {
              try {
                const innerZip = new AdmZip(src);
                for (const inEntry of innerZip.getEntries()) {
                  if (inEntry.isDirectory || inEntry.entryName.includes('..')) continue;
                  const inExt = path.extname(inEntry.entryName).toLowerCase();
                  if (validMachineExts.includes(inExt)) {
                    safeExtractBuffer(inEntry.entryName, inEntry.getData());
                  }
                }
              } catch {
                safeExtractBuffer(file, fs.readFileSync(src));
              }
            } else {
              safeExtractBuffer(file, fs.readFileSync(src));
            }
          }
        }
      }
    }

    if (extractedFiles.length === 0) {
      const errMsg = 'No valid machine files (.dst, .pes, .jef, .exp, .zip, .rar) found in the ZIP or folder.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('/admin/tools/bulk-file-relink');
    }

    const matched = [];
    const unmatched = [];
    const ambiguous = [];
    const duplicates = [];
    const seenFilesPerDesign = new Set();
    const orderPerDesign = new Map();

    for (const item of extractedFiles) {
      const result = matchFileToDesigns(item.filename, designs);
      if (result) {
        if (result.isAmbiguous) {
          ambiguous.push({
            filename: item.filename,
            size: item.size,
            candidates: (result.candidates || []).map(c => c.match.sku || c.match.title).join(', '),
            method: result.method
          });
        } else {
          const dId = result.match.id;
          const dedupKey = `${dId}_${item.filename.toLowerCase()}`;
          if (seenFilesPerDesign.has(dedupKey)) {
            duplicates.push({
              filename: item.filename,
              design: result.match,
              reason: 'Exact duplicate filename already staged for this design'
            });
            continue;
          }
          seenFilesPerDesign.add(dedupKey);

          const currentOrder = orderPerDesign.get(dId) || 0;
          orderPerDesign.set(dId, currentOrder + 1);

          matched.push({
            filename: item.filename,
            designId: dId,
            designTitle: result.match.title,
            designSku: result.match.sku || `AED-${dId}`,
            format: item.ext.replace('.', '').toUpperCase(),
            size: item.size,
            method: result.method,
            confidence: result.confidence,
            label: result.label || result.match.sku || item.filename,
            sortOrder: currentOrder
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
    fs.writeFileSync(manifestPath, JSON.stringify({ matched, unmatched, ambiguous, sessionStaging }), 'utf8');

    const preview = {
      sessionId,
      totalExtracted: extractedFiles.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      ambiguousCount: ambiguous.length,
      duplicatesCount: duplicates.length,
      matched,
      unmatched,
      ambiguous,
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
    const { sessionId, mode } = req.body;
    const relinkMode = mode === 'replace' ? 'replace' : 'append';

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

    if (db.isConnected() && relinkMode === 'replace') {
      const affectedDesignIds = [...new Set(matched.map(m => m.designId))];
      for (const dId of affectedDesignIds) {
        await db.query("DELETE FROM design_files WHERE design_id = ? AND (file_kind != 'image' OR is_preview = 0)", [dId]);
      }
    }

    let successCount = 0;
    const formatsPerDesign = new Map();

    for (const item of matched) {
      const filePath = path.join(sessionStaging, item.filename);
      if (fs.existsSync(filePath)) {
        const fileExt = path.extname(item.filename).toLowerCase();
        let mimeType = 'application/octet-stream';
        if (fileExt === '.zip') mimeType = 'application/zip';
        else if (fileExt === '.rar') mimeType = 'application/x-rar-compressed';
        else if (fileExt === '.dst') mimeType = 'application/x-tajima-dst';
        else if (fileExt === '.pes') mimeType = 'application/x-brother-pes';
        else if (fileExt === '.jef') mimeType = 'application/x-janome-jef';
        else if (fileExt === '.exp') mimeType = 'application/x-melco-exp';

        // Save to private persistent storage outside deploy directory
        const savedPath = await storage.savePrivateFile(filePath, item.filename, mimeType);
        const fmt = item.format || fileExt.replace('.', '').toUpperCase() || 'ZIP';
        const fileStat = fs.statSync(filePath);
        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

        if (db.isConnected()) {
          // If appending, determine next sort_order
          let sortOrder = item.sortOrder || 0;
          if (relinkMode === 'append') {
            const [orderRow] = await db.query(
              'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM design_files WHERE design_id = ?',
              [item.designId]
            );
            sortOrder = (orderRow ? orderRow.max_order : -1) + 1;
          }

          await db.query(
            `INSERT INTO design_files 
              (design_id, file_kind, label, original_name, storage_key, mime_type, file_size, checksum_sha256, sort_order, is_primary_preview, file_name, file_path, file_format, is_preview) 
             VALUES (?, 'machine', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`,
            [
              item.designId,
              item.label || item.filename,
              item.filename,
              savedPath,
              mimeType,
              fileStat.size,
              fileHash,
              sortOrder,
              item.filename,
              savedPath,
              fmt
            ]
          );

          if (!formatsPerDesign.has(item.designId)) {
            formatsPerDesign.set(item.designId, new Set());
          }
          formatsPerDesign.get(item.designId).add(fmt);
        }
        successCount++;
      }
    }

    // Update formats in designs table
    if (db.isConnected()) {
      for (const [dId, fmtSet] of formatsPerDesign.entries()) {
        const [existing] = await db.query('SELECT formats FROM designs WHERE id = ?', [dId]);
        const prevFmts = (existing && existing.formats) ? existing.formats.split(',').map(s => s.trim().toUpperCase()) : [];
        const combined = [...new Set([...prevFmts, ...Array.from(fmtSet)])].filter(Boolean).join(', ');
        if (combined) {
          await db.query('UPDATE designs SET formats = ? WHERE id = ?', [combined, dId]);
        }
      }
    }

    try {
      fs.rmSync(sessionStaging, { recursive: true, force: true });
    } catch (e) {}

    await ActivityLog.logFromReq(req, 'bulk_file_relink', 'design', null, `Bulk relinked ${successCount} machine files to products (Mode: ${relinkMode}).`);

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

/**
 * CSV Export for Bulk File Relink Report
 * GET /admin/tools/bulk-file-relink/export-report
 */
exports.getBulkFileRelinkExport = async (req, res, next) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).send('Session ID required.');
    }
    const sessionStaging = path.join(stagingBaseDir, `file_${sessionId}`);
    const manifestPath = path.join(sessionStaging, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).send('Session report not found or expired.');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const matched = manifest.matched || [];
    const unmatched = manifest.unmatched || [];
    const ambiguous = manifest.ambiguous || [];

    const headers = ['Status', 'Filename', 'Matched SKU', 'Target Design Title', 'Design ID', 'Format', 'File Size (Bytes)', 'Confidence', 'Match Rule', 'Assigned Label'];
    const rows = [headers.join(',')];

    for (const m of matched) {
      rows.push([
        'MATCHED',
        `"${String(m.filename || '').replace(/"/g, '""')}"`,
        `"${String(m.designSku || '').replace(/"/g, '""')}"`,
        `"${String(m.designTitle || '').replace(/"/g, '""')}"`,
        m.designId,
        m.format || 'ZIP',
        m.size || 0,
        m.confidence || 'High',
        `"${String(m.method || '').replace(/"/g, '""')}"`,
        `"${String(m.label || '').replace(/"/g, '""')}"`
      ].join(','));
    }

    for (const a of ambiguous) {
      rows.push([
        'AMBIGUOUS',
        `"${String(a.filename || '').replace(/"/g, '""')}"`,
        `"Possible: ${String(a.candidates || '').replace(/"/g, '""')}"`,
        '',
        '',
        '',
        a.size || 0,
        'Low',
        'Ambiguous Suffix/Prefix Match',
        ''
      ].join(','));
    }

    for (const u of unmatched) {
      rows.push([
        'UNMATCHED',
        `"${String(u.filename || '').replace(/"/g, '""')}"`,
        '',
        '',
        '',
        '',
        u.size || 0,
        'None',
        'No matching design SKU or Title',
        ''
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bulk-file-relink-report-${Date.now()}.csv"`);
    return res.send(rows.join('\r\n'));
  } catch (err) {
    next(err);
  }
};

/**
 * CSV Export for Bulk Image Relink Report
 * GET /admin/tools/bulk-image-relink/export-report
 */
exports.getBulkImageRelinkExport = async (req, res, next) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).send('Session ID required.');
    }
    const sessionStaging = path.join(stagingBaseDir, `img_${sessionId}`);
    const manifestPath = path.join(sessionStaging, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).send('Session report not found or expired.');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const matched = manifest.matched || [];
    const unmatched = manifest.unmatched || [];
    const ambiguous = manifest.ambiguous || [];

    const headers = ['Status', 'Filename', 'Matched SKU', 'Target Design Title', 'Design ID', 'Is Primary', 'File Size (Bytes)', 'Confidence', 'Match Rule'];
    const rows = [headers.join(',')];

    for (const m of matched) {
      rows.push([
        'MATCHED',
        `"${String(m.filename || '').replace(/"/g, '""')}"`,
        `"${String(m.designSku || '').replace(/"/g, '""')}"`,
        `"${String(m.designTitle || '').replace(/"/g, '""')}"`,
        m.designId,
        m.isPrimary ? 'YES (Primary)' : 'NO (Gallery)',
        m.size || 0,
        m.confidence || 'High',
        `"${String(m.method || '').replace(/"/g, '""')}"`
      ].join(','));
    }

    for (const a of ambiguous) {
      rows.push([
        'AMBIGUOUS',
        `"${String(a.filename || '').replace(/"/g, '""')}"`,
        `"Possible: ${String(a.candidates || '').replace(/"/g, '""')}"`,
        '',
        '',
        '',
        a.size || 0,
        'Low',
        'Ambiguous Suffix/Prefix Match'
      ].join(','));
    }

    for (const u of unmatched) {
      rows.push([
        'UNMATCHED',
        `"${String(u.filename || '').replace(/"/g, '""')}"`,
        '',
        '',
        '',
        '',
        u.size || 0,
        'None',
        'No matching design SKU or Title'
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bulk-image-relink-report-${Date.now()}.csv"`);
    return res.send(rows.join('\r\n'));
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
      .filter(f => f.endsWith('.zip') || f.endsWith('.sql') || f.endsWith('.csv'))
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

exports.postRestoreBackup = async (req, res, next) => {
  try {
    const { filename, password } = req.body;
    if (!filename || !password) {
      req.flash('error', 'Backup filename and admin password are required.');
      return res.redirect('/admin/tools/backup');
    }
    const AdminResetService = require('../../services/adminResetService');
    const result = await AdminResetService.restoreBackup(filename, req.user, password);
    req.flash('success', result.message || 'Database restored successfully!');
    res.redirect('/admin/tools/backup');
  } catch (err) {
    req.flash('error', `Restore failed: ${err.message}`);
    res.redirect('/admin/tools/backup');
  }
};

/**
 * System & Database Schema Health Dashboard
 * GET /admin/tools/system-health
 */
exports.getSystemHealth = async (req, res, next) => {
  try {
    const health = await checkSystemHealth();
    if (req.app) {
      if (health.isHealthy) {
        req.app.locals.schemaAlert = { isHealthy: true, missingTables: [], missingColumns: [], missingSummary: '' };
      } else {
        try {
          const schemaStatus = await checkSchemaSafetyOnStartup();
          req.app.locals.schemaAlert = schemaStatus;
        } catch (sErr) {}
      }
    }
    res.render('admin/tools/system-health', {
      title: 'Database & System Health - Admin',
      health,
      page: 'system-health'
    });
  } catch (err) {
    console.error('❌ [getSystemHealth Controller Error]:', err);
    res.status(500).render('admin/tools/system-health', {
      title: 'Database & System Health - Admin',
      health: {
        connected: false,
        error: 'A database inspection error occurred. Detailed error logged to server console.',
        tables: [],
        missingTables: [],
        missingColumns: [],
        stats: { totalExpectedTables: 0, existingTablesCount: 0, missingTablesCount: 0, totalExpectedColumns: 0, existingColumnsCount: 0, missingColumnsCount: 0, healthPercentage: 0 },
        migrations: { total: 0, appliedCount: 0, pendingCount: 0, isUpToDate: false, migrations: [] },
        isHealthy: false
      },
      page: 'system-health'
    });
  }
};

/**
 * Run Pending Database Migrations from UI
 * POST /admin/tools/system-health/migrate
 */
exports.postRunMigrations = async (req, res, next) => {
  try {
    console.log('[Admin Tools] Manual migration execution triggered by admin user');
    const result = await runPendingMigrations({ silent: false });
    await ActivityLog.logFromReq(req, 'migrate', 'system', null, `Executed database migrations (${result.appliedCount} applied)`);

    // Refresh schema alert
    if (req.app) {
      try {
        const schemaStatus = await checkSchemaSafetyOnStartup();
        req.app.locals.schemaAlert = schemaStatus;
      } catch (sErr) {}
    }

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.json({
        success: true,
        message: result.appliedCount === 0 
          ? 'Database schema is already up to date! Zero pending migrations.' 
          : `Successfully applied ${result.appliedCount} migration(s)!`,
        result
      });
    }

    if (result.appliedCount === 0) {
      req.flash('info', 'Database schema is already up to date. All migrations have been applied.');
    } else {
      req.flash('success', `Successfully applied ${result.appliedCount} new database migration(s)!`);
    }
    res.redirect('/admin/tools/system-health');
  } catch (err) {
    // Log real cause in server logs, show user-friendly message in UI
    console.error('❌ [Admin Tools] Error during manual migration run:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.status(500).json({
        success: false,
        message: 'Database migration failed. Please check the server error logs for full details.'
      });
    }
    req.flash('error', 'Migration operation could not be completed. The error has been logged for system diagnosis.');
    res.redirect('/admin/tools/system-health');
  }
};

/**
 * Download production_sync.sql file
 * GET /admin/tools/system-health/download-sync-sql
 */
exports.downloadProductionSyncSql = async (req, res, next) => {
  try {
    const syncSqlPath = path.resolve(__dirname, '../../migrations/production_sync.sql');
    if (!fs.existsSync(syncSqlPath)) {
      req.flash('error', 'production_sync.sql file is not present on server.');
      return res.redirect('/admin/tools/system-health');
    }
    res.download(syncSqlPath, 'production_sync.sql');
  } catch (err) {
    console.error('[downloadProductionSyncSql Error]:', err);
    next(err);
  }
};

// =========================================================================
// 5. BULK PRICE UPDATE HISTORY & AUDIT
// =========================================================================

/**
 * Render Price Update History page
 * GET /admin/tools/price-history
 */
exports.getPriceHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 15;
    const history = await bulkPriceService.getHistory({ page, limit });

    res.render('admin/tools/price-history', {
      title: 'Price Update History - Admin Tools',
      logs: history.logs,
      total: history.total,
      totalPages: history.totalPages,
      currentPage: history.currentPage
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get details of a single price update log (JSON)
 * GET /admin/tools/price-history/:id
 */
exports.getPriceHistoryDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const detail = await bulkPriceService.getHistoryDetail(id);
    res.json({ success: true, ...detail });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Unable to retrieve price update details.' });
  }
};

/**
 * Undo / Revert a past price update
 * POST /admin/tools/price-history/undo/:id
 */
exports.undoPriceHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const force = Boolean(req.body && req.body.force);
    const result = await bulkPriceService.undoPriceUpdate(id, req.user, force);
    res.json(result);
  } catch (err) {
    console.error('undoPriceHistory error:', err);
    res.status(500).json({ success: false, message: err.message || 'Unable to revert price update.' });
  }
};

/**
 * Download CSV export of a price update log
 * GET /admin/tools/price-history/download/:id
 */
exports.downloadPriceHistoryCsv = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { filename, csv } = await bulkPriceService.exportHistoryCsv(id);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('downloadPriceHistoryCsv error:', err);
    req.flash('error', err.message || 'Unable to download price update CSV.');
    res.redirect('/admin/tools/price-history');
  }
};

// =========================================================================
// 6. BULK STITCH COUNT UPDATE HISTORY & AUDIT
// =========================================================================

/**
 * Render Stitch Update History page
 * GET /admin/tools/stitch-history
 */
exports.getStitchHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 15;
    const history = await bulkStitchService.getHistory({ page, limit });

    res.render('admin/tools/stitch-history', {
      title: 'Stitch Update History - Admin Tools',
      logs: history.logs,
      total: history.pagination ? history.pagination.totalLogs : 0,
      totalPages: history.pagination ? history.pagination.totalPages : 1,
      currentPage: history.pagination ? history.pagination.currentPage : 1
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get details of a single stitch update log (JSON)
 * GET /admin/tools/stitch-history/:id
 */
exports.getStitchHistoryDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const detail = await bulkStitchService.getHistoryDetail(id);
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Stitch update log not found.' });
    }
    res.json({ success: true, ...detail });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Unable to retrieve stitch update details.' });
  }
};

/**
 * Undo / Revert a past stitch update
 * POST /admin/tools/stitch-history/undo/:id
 */
exports.undoStitchHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await bulkStitchService.undoStitchUpdate(id, req.user);
    res.json(result);
  } catch (err) {
    console.error('undoStitchHistory error:', err);
    res.status(500).json({ success: false, message: err.message || 'Unable to revert stitch update.' });
  }
};

/**
 * Download CSV export of a stitch update log
 * GET /admin/tools/stitch-history/download/:id
 */
exports.downloadStitchHistoryCsv = async (req, res, next) => {
  try {
    const { id } = req.params;
    const csv = await bulkStitchService.exportHistoryCsv(id);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="stitch_update_log_${id}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('downloadStitchHistoryCsv error:', err);
    req.flash('error', err.message || 'Unable to download stitch update CSV.');
    res.redirect('/admin/tools/stitch-history');
  }
};
// =========================================================================
// 7. REMOVE DUPLICATE FILES & IMAGES TOOL
// =========================================================================

const duplicateFilesService = require('../../services/duplicateFilesService');

/**
 * Render Remove Duplicate Files page with Dry-Run report
 * GET /admin/tools/duplicate-files
 */
exports.getDuplicateFiles = async (req, res, next) => {
  try {
    const report = await duplicateFilesService.getDryRunReport();
    const cleanups = duplicateFilesService.listCleanups();

    res.render('admin/tools/duplicate-files', {
      title: 'Remove Duplicate Files - Admin',
      report,
      cleanups,
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      messages: {
        success: req.flash('success')[0],
        error: req.flash('error')[0]
      }
    });
  } catch (err) {
    console.error('getDuplicateFiles error:', err);
    next(err);
  }
};

/**
 * Execute cleanup of duplicate files & images with backup & undo support
 * POST /admin/tools/duplicate-files/clean
 */
exports.cleanDuplicateFiles = async (req, res, next) => {
  try {
    const result = await duplicateFilesService.cleanDuplicates({
      adminId: req.user ? req.user.id : null,
      adminEmail: req.user ? req.user.email : 'admin'
    });

    req.flash('success', result.message);
    res.redirect('/admin/tools/duplicate-files');
  } catch (err) {
    console.error('cleanDuplicateFiles error:', err);
    req.flash('error', err.message || 'Unable to clean duplicates.');
    res.redirect('/admin/tools/duplicate-files');
  }
};

/**
 * Revert / Undo a Duplicate Cleanup within 7 days
 * POST /admin/tools/duplicate-files/undo/:backupFileName
 */
exports.undoDuplicateFiles = async (req, res, next) => {
  try {
    const { backupFileName } = req.params;
    const result = await duplicateFilesService.undoCleanup(backupFileName);

    req.flash('success', result.message);
    res.redirect('/admin/tools/duplicate-files');
  } catch (err) {
    console.error('undoDuplicateFiles error:', err);
    req.flash('error', err.message || 'Unable to undo cleanup.');
    res.redirect('/admin/tools/duplicate-files');
  }
};

const brokenImageService = require('../../services/brokenImageService');

/**
 * Dry-Run scan for broken and duplicate image rows
 * GET /admin/tools/missing-files/clean-broken-images/dry-run
 */
exports.getBrokenImagesDryRun = async (req, res, next) => {
  try {
    const dryRun = await brokenImageService.getBrokenImageRowsDryRun();
    const phpMyAdminSql = brokenImageService.generatePhpMyAdminSql(
      dryRun.brokenRows.map(r => r.id),
      dryRun.duplicateRows.map(r => r.id)
    );
    res.json({
      success: true,
      summary: dryRun.summary,
      brokenRows: dryRun.brokenRows.slice(0, 100),
      duplicateRows: dryRun.duplicateRows.slice(0, 100),
      brokenPreviewFiles: dryRun.brokenPreviewFiles.slice(0, 100),
      phpMyAdminSql
    });
  } catch (err) {
    console.error('getBrokenImagesDryRun error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Execute cleanup of broken & duplicate design_images rows
 * POST /admin/tools/missing-files/clean-broken-images
 */
exports.cleanBrokenImageRows = async (req, res, next) => {
  try {
    const result = await brokenImageService.removeBrokenImageRows();
    if (result.removedCount > 0) {
      await ActivityLog.log({
        action: 'clean_broken_image_rows',
        entity: 'design_images',
        entityId: null,
        details: {
          removedCount: result.removedCount,
          backupFile: result.backupFile
        },
        adminId: req.user ? req.user.id : null,
        adminEmail: req.user ? req.user.email : 'admin'
      });
    }
    res.json(result);
  } catch (err) {
    console.error('cleanBrokenImageRows error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Download phpMyAdmin SQL script
 * GET /admin/tools/missing-files/clean-broken-images/download-sql
 */
exports.downloadCleanBrokenImagesSql = async (req, res, next) => {
  try {
    const dryRun = await brokenImageService.getBrokenImageRowsDryRun();
    const sql = brokenImageService.generatePhpMyAdminSql(
      dryRun.brokenRows.map(r => r.id),
      dryRun.duplicateRows.map(r => r.id)
    );
    const filename = `clean_broken_design_images_${Date.now()}.sql`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(sql);
  } catch (err) {
    console.error('downloadCleanBrokenImagesSql error:', err);
    res.status(500).send('Error generating SQL: ' + err.message);
  }
};

/**
 * GET /admin/tools/regenerate-previews
 * Previews regeneration management page
 */
exports.getRegeneratePreviews = async (req, res, next) => {
  try {
    const Category = require('../../models/Category');
    const categories = await Category.getAll();
    const allDesigns = await Design.getAll({ limit: 10000 });
    const designsList = allDesigns.designs || [];

    const totalDesigns = designsList.length;
    let designsWithPreview = 0;
    let designsMissingPreview = 0;

    designsList.forEach(d => {
      if (d.primary_image && !d.primary_image.includes('placeholder-preview')) {
        designsWithPreview++;
      } else {
        designsMissingPreview++;
      }
    });

    res.render('admin/tools/regenerate-previews', {
      title: 'Regenerate Watermarked Previews - ARUVI Admin',
      categories,
      totalDesigns,
      designsWithPreview,
      designsMissingPreview
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/tools/regenerate-previews
 * Batch regenerates watermarked previews (1200px max + 300px thumb) with dry-run support
 */
exports.postRegeneratePreviews = async (req, res, next) => {
  try {
    const watermarkService = require('../../services/watermarkService');
    const { dry_run, batch_size = 25, category_id, scope = 'all' } = req.body || {};
    const isDryRun = dry_run === '1' || dry_run === true || dry_run === 'true';
    const limit = parseInt(batch_size, 10) || 25;

    const allDesignsResult = await Design.getAll({ 
      category: category_id && category_id !== 'all' ? category_id : null,
      limit: 10000 
    });
    let designs = allDesignsResult.designs || [];

    if (scope === 'missing_only') {
      designs = designs.filter(d => !d.primary_image || d.primary_image.includes('placeholder-preview'));
    }

    if (limit > 0 && limit < designs.length) {
      designs = designs.slice(0, limit);
    }

    const items = [];
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const previewsDir = storage.getPreviewsDir();
    const thumbsDir = storage.getThumbsDir();

    for (const design of designs) {
      const itemLog = {
        id: design.id,
        sku: design.sku || 'N/A',
        title: design.title,
        status: 'pending',
        action: '',
        previewUrl: design.primary_image || null
      };

      try {
        // Resolve candidate source image
        let candidatePath = null;
        if (design.primary_image && !design.primary_image.includes('placeholder-preview')) {
          candidatePath = storage.resolveFilePath(design.primary_image);
        }

        // If not found, check design_images table or files
        if (!candidatePath || !fs.existsSync(candidatePath)) {
          if (db.isConnected()) {
            const imgRows = await db.query('SELECT image_url FROM design_images WHERE design_id = ? ORDER BY is_primary DESC, id ASC', [design.id]);
            for (const row of imgRows) {
              const testP = storage.resolveFilePath(row.image_url);
              if (testP && fs.existsSync(testP)) {
                candidatePath = testP;
                break;
              }
            }
          }
        }

        if (!candidatePath || !fs.existsSync(candidatePath)) {
          itemLog.status = 'skipped';
          itemLog.action = 'No source image found on disk; placeholder kept.';
          skippedCount++;
          items.push(itemLog);
          continue;
        }

        const cleanSlug = (design.slug || `design-${design.id}`).replace(/[^a-z0-9_-]/gi, '_');
        const previewFileName = `preview_${cleanSlug}_${design.id}.webp`;
        const thumbFileName = `thumb_${cleanSlug}_${design.id}.webp`;
        const previewRelUrl = `/public/uploads/previews/${previewFileName}`;
        const thumbRelUrl = `/public/uploads/previews/thumbs/${thumbFileName}`;

        if (isDryRun) {
          itemLog.status = 'ready';
          itemLog.action = `Ready to generate: 1200px WebP watermark preview & 300px thumbnail (${path.basename(candidatePath)})`;
          itemLog.previewUrl = previewRelUrl;
          updatedCount++;
        } else {
          // Generate actual watermarked previews
          const generated = await watermarkService.generateWatermarkedPreviews(candidatePath, {
            maxWidth: 1200,
            maxHeight: 1200,
            thumbSize: 300,
            quality: 85
          });

          const targetPreviewPath = path.join(previewsDir, previewFileName);
          const targetThumbPath = path.join(thumbsDir, thumbFileName);

          await fs.promises.writeFile(targetPreviewPath, generated.largeBuffer);
          await fs.promises.writeFile(targetThumbPath, generated.thumbBuffer);

          // Update design_images table and designs table
          if (db.isConnected()) {
            const existingRows = await db.query('SELECT id FROM design_images WHERE design_id = ? AND is_primary = 1 LIMIT 1', [design.id]);
            if (existingRows && existingRows.length > 0) {
              await db.query('UPDATE design_images SET image_url = ?, display_order = 1, file_size = ? WHERE id = ?', [
                previewRelUrl,
                generated.largeBuffer.length,
                existingRows[0].id
              ]);
            } else {
              await db.query('INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size) VALUES (?, ?, 1, 1, ?)', [
                design.id,
                previewRelUrl,
                generated.largeBuffer.length
              ]);
            }
            await db.query('UPDATE designs SET image_url = ? WHERE id = ?', [previewRelUrl, design.id]);
          }

          itemLog.status = 'regenerated';
          itemLog.action = `Successfully created watermarked preview (${generated.width}x${generated.height}) & thumbnail (${generated.thumbWidth}x${generated.thumbHeight})`;
          itemLog.previewUrl = previewRelUrl;
          updatedCount++;
        }
      } catch (procErr) {
        itemLog.status = 'failed';
        itemLog.action = `Error: ${procErr.message}`;
        failedCount++;
      }
      items.push(itemLog);
    }

    if (!isDryRun) {
      ActivityLog.log({
        action: 'REGENERATE_PREVIEWS',
        details: {
          updatedCount,
          skippedCount,
          failedCount,
          scope,
          total: designs.length
        },
        adminId: req.user ? req.user.id : null,
        adminEmail: req.user ? req.user.email : 'admin'
      }).catch(() => {});
    }

    res.json({
      success: true,
      dryRun: isDryRun,
      totalSelected: designs.length,
      updatedCount,
      skippedCount,
      failedCount,
      items
    });
  } catch (err) {
    console.error('postRegeneratePreviews error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.matchFileToDesigns = matchFileToDesigns;

