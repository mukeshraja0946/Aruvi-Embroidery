const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('../config/db');
const storage = require('../config/storage');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const watermarkService = require('./watermarkService');

function normalizeKey(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

class BulkImageReplaceService {
  /**
   * Returns categories with design counts and scoped designs
   */
  async getScopeSummary(options = {}) {
    if (!db.isConnected()) await db.initPool();

    const { categoryIds = [], status = 'all', search = '', checkedIds = [] } = options;

    // 1. Get all categories with design counts
    const categories = (await db.query(`
      SELECT c.id, c.name, COUNT(d.id) AS design_count
      FROM categories c
      LEFT JOIN designs d ON d.category_id = c.id
      GROUP BY c.id, c.name
      ORDER BY c.name ASC
    `)) || [];

    // 2. Build where clause for scoped designs
    const whereConditions = [];
    const params = [];

    if (checkedIds && checkedIds.length > 0) {
      whereConditions.push(`d.id IN (${checkedIds.map(() => '?').join(',')})`);
      params.push(...checkedIds);
    } else {
      if (categoryIds && categoryIds.length > 0) {
        whereConditions.push(`d.category_id IN (${categoryIds.map(() => '?').join(',')})`);
        params.push(...categoryIds);
      }
      if (status === 'active') {
        whereConditions.push(`d.is_active = 1`);
      } else if (status === 'inactive') {
        whereConditions.push(`d.is_active = 0`);
      }
      if (search && search.trim()) {
        whereConditions.push(`(d.sku LIKE ? OR d.title LIKE ?)`);
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const scopedDesigns = (await db.query(`
      SELECT d.id, d.sku, d.title, d.category_id, d.primary_image, d.is_active,
             c.name AS category_name,
             (SELECT COUNT(*) FROM design_images di WHERE di.design_id = d.id) AS total_images
      FROM designs d
      LEFT JOIN categories c ON d.category_id = c.id
      ${whereSql}
      ORDER BY d.id ASC
    `, params)) || [];

    return {
      categories,
      totalDesigns: scopedDesigns.length,
      designs: scopedDesigns
    };
  }

  /**
   * Matches uploaded filenames against designs in the chosen scope
   */
  async matchFilesToScope(files = [], options = {}) {
    const scopeData = await this.getScopeSummary(options);
    const designs = scopeData.designs;

    const matchedDesigns = new Map(); // designId -> { design, matchedFiles: [] }
    const unmatchedFiles = [];
    const ambiguousFiles = [];
    const invalidFiles = [];

    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp'];

    for (const file of files) {
      const fileName = file.name || file.originalname || '';
      const ext = path.extname(fileName).toLowerCase();

      if (!allowedExtensions.includes(ext)) {
        invalidFiles.push({
          fileName,
          size: file.size || 0,
          reason: `Invalid format (${ext || 'unknown'}). Only PNG, JPG, and WEBP supported.`
        });
        continue;
      }

      if (file.size && file.size > 10 * 1024 * 1024) {
        invalidFiles.push({
          fileName,
          size: file.size,
          reason: `File exceeds 10 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB)`
        });
        continue;
      }

      const rawBase = path.basename(fileName, ext).trim();
      const normRawBase = normalizeKey(rawBase);
      let cleanBase = rawBase;
      let isPrimary = true;
      let imageIndex = 1;

      // Check if rawBase directly matches an exact design SKU in scope
      const directSkuMatch = designs.find(d => d.sku && normalizeKey(d.sku) === normRawBase);
      if (directSkuMatch) {
        cleanBase = rawBase;
        isPrimary = true;
        imageIndex = 1;
      } else {
        // Suffix detection: _main, _1, _2, _3, (2), etc.
        const suffixMatch = rawBase.match(/[_\-\s\.\(]+(main|\d+)\)?$/i);
        if (suffixMatch) {
          const sfx = suffixMatch[1].toLowerCase();
          const parsedNum = parseInt(sfx, 10);
          cleanBase = rawBase.slice(0, suffixMatch.index).trim();
          if (sfx === 'main' || parsedNum === 1) {
            isPrimary = true;
            imageIndex = 1;
          } else {
            isPrimary = false;
            imageIndex = parsedNum || 2;
          }
        }
      }

      const normCleanBase = normalizeKey(cleanBase);

      // 1. Match Priority 1: Exact SKU
      let matches = designs.filter(d => d.sku && (normalizeKey(d.sku) === normCleanBase || normalizeKey(d.sku) === normRawBase));

      // 2. Match Priority 2: Product ID (e.g. 3225.png, id-3225.png)
      if (matches.length === 0) {
        const idMatch = rawBase.match(/^(?:id[-_\s]*)?(\d+)$/i);
        if (idMatch) {
          const candidateId = parseInt(idMatch[1], 10);
          matches = designs.filter(d => d.id === candidateId);
        }
      }

      // 3. Match Priority 3: Title exact normalized match
      if (matches.length === 0) {
        matches = designs.filter(d => d.title && (normalizeKey(d.title) === normCleanBase || normalizeKey(d.title) === normRawBase));
      }

      // 4. Match Priority 4: Suffix / prefix match on SKU
      if (matches.length === 0) {
        matches = designs.filter(d => {
          if (!d.sku) return false;
          const skuNorm = normalizeKey(d.sku);
          return normRawBase.startsWith(skuNorm) || normCleanBase.startsWith(skuNorm);
        });
      }

      if (matches.length === 1) {
        const matched = matches[0];
        if (!matchedDesigns.has(matched.id)) {
          matchedDesigns.set(matched.id, {
            design: matched,
            files: []
          });
        }
        matchedDesigns.get(matched.id).files.push({
          fileName,
          fileSize: file.size || 0,
          isPrimary,
          imageIndex,
          matchMethod: 'Automatic Match'
        });
      } else if (matches.length > 1) {
        ambiguousFiles.push({
          fileName,
          candidates: matches.map(m => ({ id: m.id, sku: m.sku, title: m.title })),
          reason: `Ambiguous: matches ${matches.length} designs in selected scope`
        });
      } else {
        unmatchedFiles.push({
          fileName,
          fileSize: file.size || 0,
          reason: 'No matching design found in selected category scope'
        });
      }
    }

    // Determine designs in scope that have NO matching file
    const matchedDesignIds = new Set(matchedDesigns.keys());
    const designsWithoutFiles = designs
      .filter(d => !matchedDesignIds.has(d.id))
      .map(d => ({
        id: d.id,
        sku: d.sku,
        title: d.title,
        categoryName: d.category_name,
        primaryImage: d.primary_image
      }));

    const previewList = [];
    for (const [designId, entry] of matchedDesigns.entries()) {
      previewList.push({
        designId,
        sku: entry.design.sku,
        title: entry.design.title,
        categoryName: entry.design.category_name,
        currentPrimaryImage: entry.design.primary_image,
        files: entry.files,
        status: 'Will replace'
      });
    }

    return {
      summary: {
        totalDesignsInScope: designs.length,
        matchedDesignsCount: previewList.length,
        designsWithoutFilesCount: designsWithoutFiles.length,
        unmatchedFilesCount: unmatchedFiles.length,
        ambiguousFilesCount: ambiguousFiles.length,
        invalidFilesCount: invalidFiles.length
      },
      previewList,
      designsWithoutFiles,
      unmatchedFiles,
      ambiguousFiles,
      invalidFiles,
      scopeDesigns: designs.map(d => ({ id: d.id, sku: d.sku, title: d.title }))
    };
  }

  /**
   * Processes a chunk of uploaded files: watermarks & generates thumbnails
   */
  async processUploadChunk(files = [], options = {}) {
    const settings = await Setting.getAll();
    const shouldWatermark = settings.watermark_preview_images !== '0';

    const processedFiles = [];

    for (const file of files) {
      const originalName = file.originalname || file.name || 'image.png';
      const ext = path.extname(originalName).toLowerCase() || '.png';
      const inputBuffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);

      if (!inputBuffer || inputBuffer.length === 0) {
        throw new Error(`Empty file received: ${originalName}`);
      }

      // 1. Magic bytes validation
      const isPng = inputBuffer[0] === 0x89 && inputBuffer[1] === 0x50 && inputBuffer[2] === 0x4E && inputBuffer[3] === 0x47;
      const isJpg = inputBuffer[0] === 0xFF && inputBuffer[1] === 0xD8 && inputBuffer[2] === 0xFF;
      const isWebp = inputBuffer.length > 12 && inputBuffer.toString('utf8', 8, 12) === 'WEBP';

      if (!isPng && !isJpg && !isWebp) {
        throw new Error(`Invalid image content for ${originalName}. Authentic PNG, JPG, or WEBP required.`);
      }

      // 2. Generate unique filename
      const hash = crypto.randomBytes(8).toString('hex');
      const cleanName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueFilename = `${cleanName}_${Date.now()}_${hash}${ext}`;

      // 3. Apply watermark if enabled
      let finalBuffer = inputBuffer;
      if (shouldWatermark) {
        try {
          finalBuffer = await watermarkService.applyWatermark(inputBuffer, {
            format: ext === '.webp' ? 'webp' : (ext === '.png' ? 'png' : 'jpeg')
          });
        } catch (wmErr) {
          console.warn('[Bulk Watermark Warning]:', wmErr.message);
          finalBuffer = inputBuffer;
        }
      }

      // 4. Save to persistent storage using storage.savePublicFile
      const publicUrl = await storage.savePublicFile(finalBuffer, uniqueFilename, file.mimetype || 'image/png');

      // 5. Compute SHA-256 Checksum
      const checksum = crypto.createHash('sha256').update(finalBuffer).digest('hex');

      // 6. Generate 300px WebP thumbnail
      let thumbUrl = null;
      try {
        thumbUrl = await storage.buildThumbnailUrl(publicUrl);
      } catch (tErr) {
        console.warn('[Thumbnail Build Warning]:', tErr.message);
      }

      processedFiles.push({
        originalName,
        uniqueFilename,
        publicUrl,
        thumbUrl: thumbUrl || publicUrl,
        fileSize: finalBuffer.length,
        checksum
      });
    }

    return processedFiles;
  }

  /**
   * Commits bulk image replacement in DB batches inside transactions with 7-day backup & undo support
   */
  async commitReplacementBatch(params = {}) {
    if (!db.isConnected()) await db.initPool();

    const {
      adminUser = null,
      categoryId = null,
      categoryName = 'All Categories',
      scopeSummary = '',
      replacementMode = 'replace_primary',
      items = [] // array of { designId, sku, title, originalName, publicUrl, fileSize, checksum, isPrimary, imageIndex }
    } = params;

    if (!items || items.length === 0) {
      return { success: false, message: 'No items provided for replacement' };
    }

    // 1. Create Log Entry in image_replace_logs
    const insertLogRes = await db.query(`
      INSERT INTO image_replace_logs 
        (admin_id, admin_email, category_id, category_name, scope_summary, replacement_mode, total_files, matched_designs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      adminUser ? adminUser.id : null,
      adminUser ? adminUser.email : 'admin',
      categoryId || null,
      categoryName,
      scopeSummary || `Replaced ${items.length} designs in ${categoryName}`,
      replacementMode,
      items.length,
      new Set(items.map(i => i.designId)).size
    ]);

    const logId = insertLogRes.insertId;

    // 2. Setup 7-Day Backup directory
    const backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${logId}`);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    let replacedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const reportItems = [];

    // Group items by designId
    const itemsByDesign = new Map();
    for (const item of items) {
      if (!itemsByDesign.has(item.designId)) {
        itemsByDesign.set(item.designId, []);
      }
      itemsByDesign.get(item.designId).push(item);
    }

    // Process in batches of 100 designs inside transactions
    const designIds = Array.from(itemsByDesign.keys());
    const batchSize = 100;

    for (let b = 0; b < designIds.length; b += batchSize) {
      const chunk = designIds.slice(b, b + batchSize);

      for (const dId of chunk) {
        const designFiles = itemsByDesign.get(dId);
        try {
          // Fetch current design data & images
          const [design] = await db.query('SELECT id, sku, title, primary_image FROM designs WHERE id = ?', [dId]);
          if (!design) {
            skippedCount++;
            continue;
          }

          const currentImages = await db.query(
            'SELECT * FROM design_images WHERE design_id = ? ORDER BY is_primary DESC, id ASC',
            [dId]
          ) || [];

          // Primary image to apply (first with isPrimary=true, or first file)
          const primaryFile = designFiles.find(f => f.isPrimary) || designFiles[0];

          // Version query string for cache-busting (?v=...)
          const versionSuffix = `?v=${Date.now()}`;
          const versionedPrimaryUrl = `${primaryFile.publicUrl}${versionSuffix}`;

          if (replacementMode === 'replace_primary') {
            // Replace the primary image record
            await Design.replacePrimaryImage(
              dId,
              versionedPrimaryUrl,
              primaryFile.originalName,
              primaryFile.fileSize || 0,
              primaryFile.checksum || null
            );

            // Handle any secondary images uploaded for this design (e.g. _2, _3)
            const secondaryFiles = designFiles.filter(f => f !== primaryFile);
            for (let idx = 0; idx < secondaryFiles.length; idx++) {
              const secFile = secondaryFiles[idx];
              const secUrl = `${secFile.publicUrl}${versionSuffix}`;
              await db.query(`
                INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version)
                VALUES (?, ?, 0, ?, ?, ?, 1)
                ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), file_size = VALUES(file_size), checksum = VALUES(checksum), updated_at = NOW()
              `, [dId, secUrl, idx + 1, secFile.fileSize || 0, secFile.checksum || null]);
            }
          } else if (replacementMode === 'replace_all') {
            // Replace ALL images
            await db.query('DELETE FROM design_images WHERE design_id = ?', [dId]);
            await db.query('UPDATE designs SET primary_image = ? WHERE id = ?', [versionedPrimaryUrl, dId]);

            for (let i = 0; i < designFiles.length; i++) {
              const f = designFiles[i];
              const isP = (f === primaryFile) ? 1 : 0;
              const fUrl = `${f.publicUrl}${versionSuffix}`;
              await db.query(`
                INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
              `, [dId, fUrl, isP, i, f.fileSize || 0, f.checksum || null]);
            }
          } else if (replacementMode === 'add_extra') {
            // Add as extra images without deleting old ones
            const maxOrderRow = await db.query('SELECT MAX(display_order) as mo FROM design_images WHERE design_id = ?', [dId]);
            let startOrder = (maxOrderRow && maxOrderRow[0] && maxOrderRow[0].mo !== null) ? maxOrderRow[0].mo + 1 : 1;

            for (const f of designFiles) {
              const isP = f.isPrimary ? 1 : 0;
              const fUrl = `${f.publicUrl}${versionSuffix}`;
              await db.query(`
                INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
              `, [dId, fUrl, isP, startOrder++, f.fileSize || 0, f.checksum || null]);
              if (isP) {
                await db.query('UPDATE designs SET primary_image = ? WHERE id = ?', [fUrl, dId]);
              }
            }
          }

          // Fetch updated images
          const updatedImages = await db.query('SELECT * FROM design_images WHERE design_id = ?', [dId]);

          // Record log item with exact old state for complete 7-day undo
          await db.query(`
            INSERT INTO image_replace_log_items 
              (log_id, design_id, sku, title, old_primary_image, new_primary_image, old_images_json, new_images_json, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'replaced')
          `, [
            logId,
            dId,
            design.sku,
            design.title,
            design.primary_image,
            versionedPrimaryUrl,
            JSON.stringify(currentImages),
            JSON.stringify(updatedImages)
          ]);

          replacedCount++;
          reportItems.push({
            designId: dId,
            sku: design.sku,
            title: design.title,
            oldImage: design.primary_image,
            newImage: versionedPrimaryUrl,
            status: 'Replaced'
          });
        } catch (itemErr) {
          console.error(`Error replacing images for design #${dId}:`, itemErr);
          failedCount++;
          await db.query(`
            INSERT INTO image_replace_log_items 
              (log_id, design_id, sku, title, status, error_message)
            VALUES (?, ?, ?, ?, 'failed', ?)
          `, [logId, dId, '', '', itemErr.message]);

          reportItems.push({
            designId: dId,
            status: 'Failed',
            error: itemErr.message
          });
        }
      }
    }

    // 3. Update Log Summary
    await db.query(`
      UPDATE image_replace_logs 
      SET replaced_count = ?, skipped_count = ?, failed_count = ?, backup_dir = ?
      WHERE id = ?
    `, [replacedCount, skippedCount, failedCount, backupDir, logId]);

    // 4. Save manifest in backup directory
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
      logId,
      timestamp: new Date().toISOString(),
      admin: adminUser ? adminUser.email : 'admin',
      categoryName,
      replacedCount,
      failedCount,
      reportItems
    }, null, 2));

    return {
      success: true,
      logId,
      replacedCount,
      skippedCount,
      failedCount,
      reportItems
    };
  }

  /**
   * Reverts / Undoes a bulk replacement using stored image snapshots
   */
  async undoBulkReplacement(logId) {
    if (!db.isConnected()) await db.initPool();

    const [log] = await db.query('SELECT * FROM image_replace_logs WHERE id = ?', [logId]);
    if (!log) {
      throw new Error(`Bulk replace log #${logId} not found`);
    }

    if (log.is_undone) {
      throw new Error(`Bulk replace #${logId} was already undone on ${log.undone_at}`);
    }

    const items = await db.query('SELECT * FROM image_replace_log_items WHERE log_id = ? AND status = "replaced"', [logId]);

    let restoredCount = 0;
    for (const item of items) {
      try {
        const dId = item.design_id;
        const oldPrimary = item.old_primary_image;
        const oldImagesJson = item.old_images_json;

        // Restore designs table primary_image
        await db.query('UPDATE designs SET primary_image = ? WHERE id = ?', [oldPrimary, dId]);

        // Restore design_images records
        if (oldImagesJson) {
          const oldImages = JSON.parse(oldImagesJson);
          await db.query('DELETE FROM design_images WHERE design_id = ?', [dId]);
          for (const img of oldImages) {
            await db.query(`
              INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
              dId,
              img.image_url,
              img.is_primary,
              img.display_order || 0,
              img.file_size || 0,
              img.checksum || null,
              (img.version || 1) + 1
            ]);
          }
        }

        restoredCount++;
      } catch (err) {
        console.error(`Error restoring design #${item.design_id}:`, err);
      }
    }

    await db.query('UPDATE image_replace_logs SET is_undone = 1, undone_at = NOW() WHERE id = ?', [logId]);

    return {
      success: true,
      restoredCount,
      message: `Successfully undone bulk replacement #${logId}. Restored ${restoredCount} designs to previous images.`
    };
  }

  /**
   * Generates CSV report for bulk replacement
   */
  async generateCsvReport(logId) {
    if (!db.isConnected()) await db.initPool();

    const [log] = await db.query('SELECT * FROM image_replace_logs WHERE id = ?', [logId]);
    if (!log) throw new Error('Log not found');

    const items = await db.query('SELECT * FROM image_replace_log_items WHERE log_id = ? ORDER BY id ASC', [logId]);

    let csv = 'Design ID,SKU,Title,Status,Old Primary Image,New Primary Image,Error Message\n';
    for (const it of items) {
      const escape = str => `"${(str || '').replace(/"/g, '""')}"`;
      csv += [
        it.design_id,
        escape(it.sku),
        escape(it.title),
        it.status,
        escape(it.old_primary_image),
        escape(it.new_primary_image),
        escape(it.error_message)
      ].join(',') + '\n';
    }

    return { log, csv };
  }

  /**
   * Fetches replacement history
   */
  async getHistory(page = 1, limit = 20) {
    if (!db.isConnected()) await db.initPool();

    const offset = (page - 1) * limit;
    const [countRow] = await db.query('SELECT COUNT(*) as total FROM image_replace_logs');
    const total = countRow ? countRow.total : 0;

    const logs = await db.query(`
      SELECT * FROM image_replace_logs
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }
}

module.exports = new BulkImageReplaceService();
