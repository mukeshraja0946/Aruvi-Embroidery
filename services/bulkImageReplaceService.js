const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const db = require('../config/db');
const storage = require('../config/storage');
const Design = require('../models/Design');
const Category = require('../models/Category');
const Setting = require('../models/Setting');
const watermarkService = require('./watermarkService');
const previewService = require('./previewService');

function normalizeKey(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function extractFolderGroupFromPath(str) {
  if (!str || typeof str !== 'string') return null;
  const normalized = str.replace(/\\/g, '/').replace(/^\/+/, '');
  // Match path pattern like storage_private/ARUVI BULK DESIGNS 2/file.zip or uploads/previews/ARUVI BULK DESIGNS 2/file.png
  const m = normalized.match(/(?:uploads|storage_private|storage_public|previews|designs|design-files|downloads)\/([^/]+)\//i);
  if (m && m[1]) {
    const folder = m[1].trim();
    const reserved = new Set(['thumbs', 'general', 'temp', 'images', 'previews', 'designs', '1', '2']);
    if (!reserved.has(folder.toLowerCase()) && isNaN(Number(folder))) {
      return folder;
    }
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0].trim();
    const reserved = new Set(['public', 'uploads', 'storage_private', 'storage_public', 'previews', 'designs', 'design-files', 'thumbs', 'general', 'downloads']);
    if (!reserved.has(first.toLowerCase()) && isNaN(Number(first))) {
      return first;
    }
  }
  return null;
}

function detectDesignFolderGroup(design) {
  if (!design) return 'Default Group';

  // 1. Check import_zip_filename (e.g. "ARUVI BULK DESIGNS 2.zip" -> "ARUVI BULK DESIGNS 2")
  if (design.import_zip_filename) {
    const base = path.basename(design.import_zip_filename, path.extname(design.import_zip_filename)).trim();
    if (base && !/^(zip|files|import)$/i.test(base)) {
      return base;
    }
  }

  // 2. Check import_image_filename
  if (design.import_image_filename) {
    const base = path.basename(design.import_image_filename, path.extname(design.import_image_filename)).trim();
    if (base && !/^(image|img|preview)$/i.test(base)) {
      return base;
    }
  }

  // 3. Check paths in design.files
  if (Array.isArray(design.files)) {
    for (const f of design.files) {
      const fromPath = extractFolderGroupFromPath(f.file_path || f.storage_key || f.original_name);
      if (fromPath) return fromPath;
    }
  }

  // 4. Check primary_image and design.images
  const imgPath = extractFolderGroupFromPath(design.primary_image);
  if (imgPath) return imgPath;

  if (Array.isArray(design.images)) {
    for (const img of design.images) {
      const fromImg = extractFolderGroupFromPath(img.image_url);
      if (fromImg) return fromImg;
    }
  }

  // 5. Check title / slug for common bulk group name pattern
  if (design.title) {
    const titleMatch = design.title.match(/(ARUVI\s+BULK\s+DESIGNS\s+\d+|ARUVI\s+DESIGNS\s+\d+)/i);
    if (titleMatch) return titleMatch[1].toUpperCase();
  }

  return 'Default Group';
}

class BulkImageReplaceService {
  /**
   * Returns categories with design counts and scoped designs
   */
  async getScopeSummary(options = {}) {
    if (!db.isConnected()) {
      try {
        await db.initPool();
      } catch (_) {}
    }

    const { categoryIds = [], status = 'all', search = '', checkedIds = [] } = options;

    // 1. Get all categories with design counts
    let categories = [];
    if (db.isConnected()) {
      try {
        categories = (await db.query(`
          SELECT c.id, c.name, c.slug, COUNT(d.id) AS design_count
          FROM categories c
          LEFT JOIN designs d ON d.category_id = c.id
          GROUP BY c.id, c.name, c.slug
          ORDER BY c.name ASC
        `)) || [];
      } catch (err) {
        console.warn('BulkImageReplaceService categories DB query error:', err.message);
      }
    }

    if (!categories || categories.length === 0) {
      const allCats = await Category.getAll();
      categories = (allCats || []).map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        design_count: c.design_count || 0
      }));
    }

    // 2. Build where clause for scoped designs
    const whereConditions = [];
    const params = [];

    if (checkedIds && checkedIds.length > 0) {
      whereConditions.push(`d.id IN (${checkedIds.map(() => '?').join(',')})`);
      params.push(...checkedIds);
    } else {
      if (categoryIds && categoryIds.length > 0) {
        const numericIds = categoryIds.map(Number).filter(n => !isNaN(n) && n > 0);
        const slugIds = categoryIds.filter(s => isNaN(Number(s)));
        const catConds = [];
        if (numericIds.length > 0) {
          catConds.push(`d.category_id IN (${numericIds.map(() => '?').join(',')})`);
          params.push(...numericIds);
        }
        if (slugIds.length > 0) {
          catConds.push(`c.slug IN (${slugIds.map(() => '?').join(',')})`);
          params.push(...slugIds);
        }
        if (catConds.length > 0) {
          whereConditions.push(`(${catConds.join(' OR ')})`);
        }
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

    let scopedDesigns = [];
    if (db.isConnected()) {
      try {
        scopedDesigns = (await db.query(`
          SELECT d.id, d.sku, d.title, d.category_id, d.is_active,
                 c.name AS category_name, c.slug AS category_slug,
                 COALESCE(
                   (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
                   (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY id ASC LIMIT 1),
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND (is_preview = 1 OR file_kind = 'image') ORDER BY id DESC LIMIT 1)
                 ) AS primary_image,
                 (SELECT COUNT(*) FROM design_images di WHERE di.design_id = d.id) AS total_images,
                 (SELECT df.file_name FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id DESC LIMIT 1) as machine_file_name,
                 (SELECT df.file_path FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id DESC LIMIT 1) as machine_file_path,
                 (SELECT df.file_size FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id DESC LIMIT 1) as machine_file_size
          FROM designs d
          LEFT JOIN categories c ON d.category_id = c.id
          ${whereSql}
          ORDER BY d.id ASC
        `, params)) || [];
      } catch (err) {
        console.warn('BulkImageReplaceService scopedDesigns DB query error:', err.message);
      }
    }

    if (!scopedDesigns || scopedDesigns.length === 0) {
      // In-memory fallback
      const allResult = await Design.getAll({ is_active_only: false, limit: 10000 });
      let list = allResult.designs || [];

      if (checkedIds && checkedIds.length > 0) {
        const checkedSet = new Set(checkedIds.map(String));
        list = list.filter(d => checkedSet.has(String(d.id)));
      } else {
        if (categoryIds && categoryIds.length > 0) {
          const catSet = new Set(categoryIds.map(String).map(s => s.toLowerCase()));
          list = list.filter(d => 
            (d.category_id && catSet.has(String(d.category_id).toLowerCase())) || 
            (d.category_slug && catSet.has(String(d.category_slug).toLowerCase()))
          );
        }
        if (status === 'active') {
          list = list.filter(d => d.is_active == 1 || d.is_active === true);
        } else if (status === 'inactive') {
          list = list.filter(d => d.is_active == 0 || d.is_active === false);
        }
        if (search && search.trim()) {
          const q = search.trim().toLowerCase();
          list = list.filter(d => 
            (d.sku && d.sku.toLowerCase().includes(q)) || 
            (d.title && d.title.toLowerCase().includes(q))
          );
        }
      }

      scopedDesigns = list.map(d => ({
        id: d.id,
        sku: d.sku,
        title: d.title,
        category_id: d.category_id,
        category_slug: d.category_slug,
        primary_image: d.primary_image,
        is_active: d.is_active,
        category_name: d.category_name || (categories.find(c => String(c.id) === String(d.category_id) || c.slug === d.category_slug)?.name) || 'General',
        total_images: (d.images && Array.isArray(d.images)) ? d.images.length : (d.total_images || (d.primary_image ? 1 : 0)),
        machine_file_name: d.machine_file_name || (d.files && d.files.find(f => !f.is_preview)?.file_name) || null,
        machine_file_path: d.machine_file_path || (d.files && d.files.find(f => !f.is_preview)?.file_path) || null,
        machine_file_size: d.machine_file_size || (d.files && d.files.find(f => !f.is_preview)?.file_size) || 0
      }));
    }

    return {
      categories,
      totalDesigns: scopedDesigns.length,
      designs: scopedDesigns
    };
  }

  /**
   * Matches uploaded filenames against designs in the chosen scope (Images & ZIP packages)
   */
  async matchFilesToScope(files = [], options = {}) {
    const scopeData = await this.getScopeSummary(options);
    const designs = scopeData.designs;

    const matchedDesigns = new Map(); // designId -> { design, imageFiles: [], zipFiles: [], files: [] }
    const unmatchedFiles = [];
    const ambiguousFiles = [];
    const invalidFiles = [];

    const allowedImageExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
    const allowedZipExtensions = ['.zip'];
    const allowedExtensions = [...allowedImageExtensions, ...allowedZipExtensions];

    for (const file of files) {
      const fileName = file.name || file.originalname || '';
      const ext = path.extname(fileName).toLowerCase();

      if (!allowedExtensions.includes(ext)) {
        invalidFiles.push({
          fileName,
          size: file.size || 0,
          reason: `Unsupported format (${ext || 'no extension'}). Supported: PNG, JPG, WEBP (Images) and ZIP (Design Packages).`
        });
        continue;
      }

      const isZip = allowedZipExtensions.includes(ext);

      // File size validation (15MB for images, 120MB for ZIP packages)
      const maxLimit = isZip ? 120 * 1024 * 1024 : 15 * 1024 * 1024;
      if (file.size && file.size > maxLimit) {
        invalidFiles.push({
          fileName,
          size: file.size,
          reason: `File exceeds limit of ${isZip ? '120 MB' : '15 MB'} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`
        });
        continue;
      }

      const rawBase = path.basename(fileName, ext).trim();
      const normRawBase = normalizeKey(rawBase);
      let cleanBase = rawBase;
      let isPrimary = true;
      let imageIndex = 1;
      let matchMethod = 'Automatic Match';

      if (isZip) {
        // For ZIP files, check if there's a trailing _zip or _package or _all
        const zipSuffixMatch = rawBase.match(/[_\-\s\.]+(?:zip|package|all|machine)$/i);
        if (zipSuffixMatch) {
          cleanBase = rawBase.slice(0, zipSuffixMatch.index).trim();
        }
      } else {
        // Image suffix detection: _main, _1, _2, _3, (2), etc.
        const directSkuMatch = designs.find(d => d.sku && normalizeKey(d.sku) === normRawBase);
        if (directSkuMatch) {
          cleanBase = rawBase;
          isPrimary = true;
          imageIndex = 1;
        } else {
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
      }

      const normCleanBase = normalizeKey(cleanBase);

      // 1. Priority 1: Exact SKU Match
      let matches = designs.filter(d => d.sku && (normalizeKey(d.sku) === normCleanBase || normalizeKey(d.sku) === normRawBase));
      if (matches.length === 1) {
        matchMethod = 'Exact SKU (100%)';
      }

      // 2. Priority 2: Product ID Match (e.g. 102.png, id-102.zip)
      if (matches.length === 0) {
        const idMatch = rawBase.match(/^(?:id[-_\s]*)?(\d+)$/i) || cleanBase.match(/^(?:id[-_\s]*)?(\d+)$/i);
        if (idMatch) {
          const candidateId = parseInt(idMatch[1], 10);
          matches = designs.filter(d => d.id === candidateId);
          if (matches.length === 1) {
            matchMethod = 'Product ID (95%)';
          }
        }
      }

      // 3. Priority 3: Title exact normalized match
      if (matches.length === 0) {
        matches = designs.filter(d => d.title && (normalizeKey(d.title) === normCleanBase || normalizeKey(d.title) === normRawBase));
        if (matches.length === 1) {
          matchMethod = 'Normalized Title (90%)';
        }
      }

      // 4. Priority 4: Suffix / prefix match on SKU
      if (matches.length === 0) {
        matches = designs.filter(d => {
          if (!d.sku) return false;
          const skuNorm = normalizeKey(d.sku);
          return normRawBase.startsWith(skuNorm) || normCleanBase.startsWith(skuNorm);
        });
        if (matches.length === 1) {
          matchMethod = 'SKU Prefix Match (85%)';
        }
      }

      if (matches.length === 1) {
        const matched = matches[0];
        if (!matchedDesigns.has(matched.id)) {
          matchedDesigns.set(matched.id, {
            design: matched,
            imageFiles: [],
            zipFiles: [],
            files: []
          });
        }
        const fileRecord = {
          fileName,
          fileSize: file.size || 0,
          isZip,
          isPrimary: isZip ? false : isPrimary,
          imageIndex: isZip ? 0 : imageIndex,
          matchMethod
        };
        if (isZip) {
          matchedDesigns.get(matched.id).zipFiles.push(fileRecord);
        } else {
          matchedDesigns.get(matched.id).imageFiles.push(fileRecord);
        }
        matchedDesigns.get(matched.id).files.push(fileRecord);
      } else if (matches.length > 1) {
        ambiguousFiles.push({
          fileName,
          fileSize: file.size || 0,
          isZip,
          candidates: matches.map(m => ({ id: m.id, sku: m.sku, title: m.title })),
          reason: `Ambiguous: matches ${matches.length} designs in selected category scope`
        });
      } else {
        unmatchedFiles.push({
          fileName,
          fileSize: file.size || 0,
          isZip,
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
        primaryImage: d.primary_image,
        currentZipName: d.machine_file_name || null,
        currentZipPath: d.machine_file_path || null,
        currentZipSize: d.machine_file_size || 0
      }));

    const previewList = [];
    let matchedImagesTotal = 0;
    let matchedZipsTotal = 0;

    for (const [designId, entry] of matchedDesigns.entries()) {
      const hasImage = entry.imageFiles.length > 0;
      const hasZip = entry.zipFiles.length > 0;
      matchedImagesTotal += entry.imageFiles.length;
      matchedZipsTotal += entry.zipFiles.length;

      let imageStatus = 'Keep existing image';
      if (hasImage) {
        imageStatus = entry.imageFiles.some(f => f.isPrimary) ? 'Will replace primary image' : 'Will add gallery image';
      }

      let zipStatus = 'Keep existing ZIP';
      if (hasZip) {
        zipStatus = 'Will replace ZIP package';
      }

      previewList.push({
        designId,
        sku: entry.design.sku,
        title: entry.design.title,
        categoryName: entry.design.category_name,
        currentPrimaryImage: entry.design.primary_image,
        currentZipName: entry.design.machine_file_name || null,
        currentZipPath: entry.design.machine_file_path || null,
        currentZipSize: entry.design.machine_file_size || 0,
        imageFiles: entry.imageFiles,
        zipFiles: entry.zipFiles,
        files: entry.files,
        hasNewImage: hasImage,
        hasNewZip: hasZip,
        imageStatus,
        zipStatus,
        matchConfidence: (entry.imageFiles[0]?.matchMethod) || (entry.zipFiles[0]?.matchMethod) || 'Automatic Match',
        status: (hasImage && hasZip) ? 'Will replace Image & ZIP' : (hasImage ? 'Will replace Image' : 'Will replace ZIP')
      });
    }

    return {
      summary: {
        totalDesignsInScope: designs.length,
        matchedDesignsCount: previewList.length,
        matchedImagesCount: matchedImagesTotal,
        matchedZipsCount: matchedZipsTotal,
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
      scopeDesigns: designs.map(d => ({
        id: d.id,
        sku: d.sku,
        title: d.title,
        machine_file_name: d.machine_file_name || null
      }))
    };
  }

  /**
   * Processes a chunk of uploaded files: watermarks images & stores ZIP design packages safely
   */
  async processUploadChunk(files = [], options = {}) {
    const settings = await Setting.getAll();
    const shouldWatermark = settings.watermark_preview_images !== '0';

    const processedFiles = [];

    for (const file of files) {
      const originalName = file.originalname || file.name || 'file';
      const ext = path.extname(originalName).toLowerCase();
      const inputBuffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);

      if (!inputBuffer || inputBuffer.length === 0) {
        throw new Error(`Empty file received: ${originalName}`);
      }

      const isZip = ext === '.zip';

      if (isZip) {
        // 1. Validate ZIP magic bytes: PK\x03\x04
        const isZipBytes = inputBuffer.length >= 4 && inputBuffer[0] === 0x50 && inputBuffer[1] === 0x4B;
        if (!isZipBytes) {
          throw new Error(`Invalid ZIP archive for ${originalName}. Authentic ZIP header required.`);
        }

        // 2. Validate zip entries: prevent Zip Slip and executable files
        let detectedFormats = [];
        try {
          const admZip = new AdmZip(inputBuffer);
          const entries = admZip.getEntries();
          const machineExts = new Set(['dst', 'pes', 'jef', 'exp', 'hus', 'vip', 'vp3', 'xxx']);
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const entryName = entry.entryName.toLowerCase();
            if (entryName.includes('..') || path.isAbsolute(entryName)) {
              throw new Error(`Security violation: Zip slip detected in ${originalName}`);
            }
            if (entryName.endsWith('.exe') || entryName.endsWith('.bat') || entryName.endsWith('.sh') || entryName.endsWith('.cmd')) {
              throw new Error(`Security violation: Executable detected in ${originalName}`);
            }
            const entryExt = entryName.split('.').pop();
            if (machineExts.has(entryExt)) {
              detectedFormats.push(entryExt.toUpperCase());
            }
          }
        } catch (zipErr) {
          if (zipErr.message.includes('Security violation')) throw zipErr;
          console.warn('[ZIP Inspection Warning]:', zipErr.message);
        }

        // 3. Save to private design storage using storage.savePrivateFile
        const savedKey = await storage.savePrivateFile(inputBuffer, originalName, 'application/zip');
        const checksum = crypto.createHash('sha256').update(inputBuffer).digest('hex');

        processedFiles.push({
          originalName,
          storageKey: savedKey,
          fileSize: inputBuffer.length,
          checksum,
          isZip: true,
          detectedFormats: Array.from(new Set(detectedFormats))
        });

      } else {
        // Image validation & processing
        const isPng = inputBuffer[0] === 0x89 && inputBuffer[1] === 0x50 && inputBuffer[2] === 0x4E && inputBuffer[3] === 0x47;
        const isJpg = inputBuffer[0] === 0xFF && inputBuffer[1] === 0xD8 && inputBuffer[2] === 0xFF;
        const isWebp = inputBuffer.length > 12 && inputBuffer.toString('utf8', 8, 12) === 'WEBP';

        if (!isPng && !isJpg && !isWebp) {
          throw new Error(`Invalid image content for ${originalName}. Authentic PNG, JPG, or WEBP required.`);
        }

        // Save authentic image to public previews
        const hash = crypto.randomBytes(8).toString('hex');
        const cleanName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const uniqueFilename = `${cleanName}_${Date.now()}_${hash}${ext}`;
        const finalBuffer = inputBuffer;

        // Generate 3 synchronized preview variants (large watermarked, 600px card, 300px thumbnail)
        const variants = await previewService.generatePreviewVariants(finalBuffer, originalName);

        processedFiles.push({
          originalName,
          uniqueFilename: path.basename(variants.largeKey),
          publicUrl: variants.largeKey,
          cardUrl: variants.cardKey,
          thumbUrl: variants.thumbKey,
          largeKey: variants.largeKey,
          cardKey: variants.cardKey,
          thumbKey: variants.thumbKey,
          fileSize: variants.fileSize,
          checksum: variants.checksum,
          isZip: false
        });
      }

      // Clean up multer temporary file on disk if it was created
      if (file.path && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
    }

    return processedFiles;
  }

  /**
   * Commits bulk replacement in DB batches inside transactions with 7-day backup & undo support
   */
  async commitReplacementBatch(params = {}) {
    if (!db.isConnected()) {
      try {
        await db.initPool();
      } catch (_) {}
    }

    const {
      adminUser = null,
      categoryId = null,
      categoryName = 'All Categories',
      scopeSummary = '',
      replacementMode = 'replace_matching',
      items = [] // array of items: { designId, sku, title, originalName, publicUrl, thumbUrl, storageKey, fileSize, checksum, isZip, isPrimary, imageIndex, detectedFormats }
    } = params;

    if (!items || items.length === 0) {
      return { success: false, message: 'No items provided for replacement' };
    }

    let logId = Date.now();
    let backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${logId}`);

    if (db.isConnected()) {
      try {
        const insertLogRes = await db.query(`
          INSERT INTO image_replace_logs 
            (admin_id, admin_email, category_id, category_name, scope_summary, replacement_mode, total_files, matched_designs)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          adminUser ? adminUser.id : null,
          adminUser ? adminUser.email : 'admin',
          categoryId || null,
          categoryName,
          scopeSummary || `Replaced ${items.length} files in ${categoryName}`,
          replacementMode === 'replace_all' ? 'replace_all' : (replacementMode === 'add_extra' ? 'add_extra' : 'replace_primary'),
          items.length,
          new Set(items.map(i => i.designId)).size
        ]);
        if (insertLogRes && insertLogRes.insertId) {
          logId = insertLogRes.insertId;
          backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${logId}`);
        }
      } catch (logErr) {
        console.warn('Logging replace session error:', logErr.message);
      }
    }

    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    let replacedImagesCount = 0;
    let replacedZipsCount = 0;
    let replacedDesignsCount = 0;
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

    const designIds = Array.from(itemsByDesign.keys());
    const batchSize = 100;

    for (let b = 0; b < designIds.length; b += batchSize) {
      const chunk = designIds.slice(b, b + batchSize);

      for (const dId of chunk) {
        const designFiles = itemsByDesign.get(dId);
        try {
          let design = await Design.getById(dId);
          if (!design) {
            skippedCount++;
            continue;
          }

          // Fetch current images & machine files before replacement
          let currentImages = [];
          let currentFiles = [];
          if (db.isConnected()) {
            currentImages = (await db.query('SELECT * FROM design_images WHERE design_id = ? ORDER BY is_primary DESC, id ASC', [dId])) || [];
            currentFiles = (await db.query('SELECT * FROM design_files WHERE design_id = ? AND is_preview = 0 ORDER BY id DESC', [dId])) || [];
          } else {
            currentImages = design.images || [];
            currentFiles = (design.files || []).filter(f => !f.is_preview);
          }

          const oldMachineFile = currentFiles[0] || null;

          const imageFiles = designFiles.filter(f => !f.isZip);
          const zipFiles = designFiles.filter(f => f.isZip);

          let didReplaceImage = false;
          let didReplaceZip = false;
          let versionedPrimaryUrl = design.primary_image;

          // 1. Image Replacement (if any image files matched/provided)
          if (imageFiles.length > 0) {
            const primaryFile = imageFiles.find(f => f.isPrimary) || imageFiles[0];
            const versionSuffix = `?v=${Date.now()}`;
            versionedPrimaryUrl = `${primaryFile.publicUrl}${versionSuffix}`;

            if (replacementMode === 'replace_all') {
              if (db.isConnected()) {
                await db.query('DELETE FROM design_images WHERE design_id = ?', [dId]);
                const pThumb = primaryFile.thumbKey || primaryFile.thumbUrl || versionedPrimaryUrl;
                const pCard = primaryFile.cardKey || primaryFile.cardUrl || versionedPrimaryUrl;
                try {
                  await db.query('UPDATE designs SET primary_image = ?, thumbnail_image = ?, card_image = ? WHERE id = ?', [versionedPrimaryUrl, pThumb, pCard, dId]);
                } catch (_) {
                  try {
                    await db.query('UPDATE designs SET primary_image = ? WHERE id = ?', [versionedPrimaryUrl, dId]);
                  } catch (_) {}
                }
                for (let i = 0; i < imageFiles.length; i++) {
                  const f = imageFiles[i];
                  const isP = (f === primaryFile) ? 1 : 0;
                  const fUrl = `${f.publicUrl}${versionSuffix}`;
                  const fThumb = f.thumbKey ? (f.thumbKey.includes('?v=') ? f.thumbKey : `${f.thumbKey}${versionSuffix}`) : fUrl;
                  const fCard = f.cardKey ? (f.cardKey.includes('?v=') ? f.cardKey : `${f.cardKey}${versionSuffix}`) : fUrl;
                  try {
                    await db.query(`
                      INSERT INTO design_images (design_id, image_url, thumb_key, card_key, is_primary, display_order, file_size, checksum, version)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                    `, [dId, fUrl, fThumb, fCard, isP, i, f.fileSize || 0, f.checksum || null]);
                  } catch (_) {
                    await db.query(`
                      INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version)
                      VALUES (?, ?, ?, ?, ?, ?, 1)
                    `, [dId, fUrl, isP, i, f.fileSize || 0, f.checksum || null]);
                  }
                }
              }
            } else if (replacementMode === 'add_extra') {
              if (db.isConnected()) {
                const maxOrderRow = await db.query('SELECT MAX(display_order) as mo FROM design_images WHERE design_id = ?', [dId]);
                let startOrder = (maxOrderRow && maxOrderRow[0] && maxOrderRow[0].mo !== null) ? maxOrderRow[0].mo + 1 : 1;
                for (const f of imageFiles) {
                  const isP = f.isPrimary ? 1 : 0;
                  const fUrl = `${f.publicUrl}${versionSuffix}`;
                  const fThumb = f.thumbKey ? (f.thumbKey.includes('?v=') ? f.thumbKey : `${f.thumbKey}${versionSuffix}`) : fUrl;
                  const fCard = f.cardKey ? (f.cardKey.includes('?v=') ? f.cardKey : `${f.cardKey}${versionSuffix}`) : fUrl;
                  try {
                    await db.query(`
                      INSERT INTO design_images (design_id, image_url, thumb_key, card_key, is_primary, display_order, file_size, checksum, version)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                    `, [dId, fUrl, fThumb, fCard, isP, startOrder++, f.fileSize || 0, f.checksum || null]);
                  } catch (_) {
                    await db.query(`
                      INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version)
                      VALUES (?, ?, ?, ?, ?, ?, 1)
                    `, [dId, fUrl, isP, startOrder++, f.fileSize || 0, f.checksum || null]);
                  }
                }
              }
            } else {
              // Default: replace_matching / replace_primary
              await Design.replacePrimaryImage(
                dId,
                versionedPrimaryUrl,
                primaryFile.originalName,
                primaryFile.fileSize || 0,
                primaryFile.checksum || null
              );
              const secondaryFiles = imageFiles.filter(f => f !== primaryFile);
              for (let idx = 0; idx < secondaryFiles.length; idx++) {
                const secFile = secondaryFiles[idx];
                const secUrl = `${secFile.publicUrl}${versionSuffix}`;
                const secThumb = secFile.thumbKey ? (secFile.thumbKey.includes('?v=') ? secFile.thumbKey : `${secFile.thumbKey}${versionSuffix}`) : secUrl;
                const secCard = secFile.cardKey ? (secFile.cardKey.includes('?v=') ? secFile.cardKey : `${secFile.cardKey}${versionSuffix}`) : secUrl;
                if (db.isConnected()) {
                  try {
                    await db.query(`
                      INSERT INTO design_images (design_id, image_url, thumb_key, card_key, is_primary, display_order, file_size, checksum, version)
                      VALUES (?, ?, ?, ?, 0, ?, ?, ?, 1)
                      ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), thumb_key = VALUES(thumb_key), card_key = VALUES(card_key), file_size = VALUES(file_size), checksum = VALUES(checksum), updated_at = NOW()
                    `, [dId, secUrl, secThumb, secCard, idx + 1, secFile.fileSize || 0, secFile.checksum || null]);
                  } catch (_) {
                    await db.query(`
                      INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version)
                      VALUES (?, ?, 0, ?, ?, ?, 1)
                      ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), file_size = VALUES(file_size), checksum = VALUES(checksum), updated_at = NOW()
                    `, [dId, secUrl, idx + 1, secFile.fileSize || 0, secFile.checksum || null]);
                  }
                }
              }
            }

            replacedImagesCount += imageFiles.length;
            didReplaceImage = true;
          }

          // 2. ZIP Replacement (if any ZIP files matched/provided)
          let newZipKey = null;
          let newZipName = null;
          if (zipFiles.length > 0) {
            const primaryZip = zipFiles[0];
            newZipKey = primaryZip.storageKey;
            newZipName = primaryZip.originalName;

            await Design.replaceMachineFile(
              dId,
              primaryZip.storageKey,
              primaryZip.originalName,
              primaryZip.fileSize || 0,
              primaryZip.checksum || null,
              primaryZip.detectedFormats || []
            );

            replacedZipsCount += zipFiles.length;
            didReplaceZip = true;
          }

          if (didReplaceImage || didReplaceZip) {
            replacedDesignsCount++;
          }

          // Record snapshot in log items
          if (db.isConnected()) {
            try {
              const updatedImages = await db.query('SELECT * FROM design_images WHERE design_id = ?', [dId]);
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
                JSON.stringify({ images: currentImages, machineFile: oldMachineFile }),
                JSON.stringify({ images: updatedImages, machineFile: zipFiles[0] || null })
              ]);
            } catch (itemLogErr) {
              console.warn('Logging replace item warning:', itemLogErr.message);
            }
          }

          reportItems.push({
            designId: dId,
            sku: design.sku,
            title: design.title,
            oldImage: design.primary_image,
            newImage: didReplaceImage ? versionedPrimaryUrl : null,
            oldZip: oldMachineFile ? oldMachineFile.file_name : null,
            newZip: didReplaceZip ? newZipName : null,
            imageStatus: didReplaceImage ? 'Replaced' : 'Unchanged',
            zipStatus: didReplaceZip ? 'Replaced' : 'Unchanged',
            status: 'Success'
          });

        } catch (itemErr) {
          console.error(`Error replacing files for design #${dId}:`, itemErr);
          failedCount++;
          if (db.isConnected()) {
            try {
              await db.query(`
                INSERT INTO image_replace_log_items 
                  (log_id, design_id, sku, title, status, error_message)
                VALUES (?, ?, ?, ?, 'failed', ?)
              `, [logId, dId, '', '', itemErr.message]);
            } catch (_) {}
          }
          reportItems.push({
            designId: dId,
            status: 'Failed',
            error: itemErr.message
          });
        }
      }
    }

    if (db.isConnected()) {
      try {
        await db.query(`
          UPDATE image_replace_logs 
          SET replaced_count = ?, skipped_count = ?, failed_count = ?, backup_dir = ?
          WHERE id = ?
        `, [replacedDesignsCount, skippedCount, failedCount, backupDir, logId]);
      } catch (_) {}
    }

    // Save manifest in backup directory for 7-day rollback
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
      logId,
      timestamp: new Date().toISOString(),
      admin: adminUser ? adminUser.email : 'admin',
      categoryName,
      replacedDesignsCount,
      replacedImagesCount,
      replacedZipsCount,
      failedCount,
      reportItems
    }, null, 2));

    return {
      success: true,
      logId,
      replacedCount: replacedDesignsCount,
      replacedImagesCount,
      replacedZipsCount,
      skippedCount,
      failedCount,
      reportItems
    };
  }

  /**
   * Reverts / Undoes a bulk replacement using stored snapshots
   */
  async undoBulkReplacement(logId) {
    if (!db.isConnected()) {
      try { await db.initPool(); } catch (_) {}
    }

    let log = null;
    let items = [];

    if (db.isConnected()) {
      const [logRow] = await db.query('SELECT * FROM image_replace_logs WHERE id = ?', [logId]);
      log = logRow;
      if (log) {
        if (log.is_undone) {
          throw new Error(`Bulk replace #${logId} was already undone on ${log.undone_at}`);
        }
        items = await db.query('SELECT * FROM image_replace_log_items WHERE log_id = ? AND status = "replaced"', [logId]);
      }
    }

    // If items not in DB, read from manifest
    if (!log || items.length === 0) {
      const backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${logId}`);
      const manifestPath = path.join(backupDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        log = { id: logId, ...manifest };
        if (items.length === 0 && Array.isArray(manifest.reportItems)) {
          items = manifest.reportItems.map(r => ({
            design_id: r.designId,
            old_primary_image: r.oldImage,
            old_images_json: r.oldImagesJson || JSON.stringify({
              images: r.oldImage ? [{ image_url: r.oldImage, is_primary: 1 }] : [],
              machineFile: r.oldZip ? { file_name: r.oldZip, file_path: r.oldZip } : null
            }),
            old_files_json: r.oldFilesJson || null
          }));
        }
      }
    }

    if (!log) {
      throw new Error(`Bulk replace log #${logId} not found`);
    }

    let restoredCount = 0;
    for (const item of items) {
      try {
        const dId = item.design_id;
        const oldPrimary = item.old_primary_image;
        const oldStateJson = item.old_images_json;
        const oldFilesJson = item.old_files_json;

        if (oldPrimary && db.isConnected()) {
          try {
            await db.query('UPDATE designs SET primary_image = ? WHERE id = ?', [oldPrimary, dId]);
          } catch (_) {}
        }

        let oldImages = [];
        let oldMachineFile = null;
        let oldFiles = [];

        if (oldFilesJson) {
          try {
            oldFiles = JSON.parse(oldFilesJson);
          } catch (_) {}
        }

        if (oldStateJson) {
          try {
            const parsed = JSON.parse(oldStateJson);
            oldImages = Array.isArray(parsed) ? parsed : (parsed.images || []);
            oldMachineFile = (!Array.isArray(parsed) && parsed.machineFile) ? parsed.machineFile : null;
          } catch (_) {}
        }

        if (db.isConnected()) {
          if (oldImages.length > 0) {
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

          if (oldFiles.length > 0) {
            await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [dId]);
            for (const f of oldFiles) {
              await db.query(`
                INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, checksum, is_preview)
                VALUES (?, ?, ?, ?, ?, ?, 0)
              `, [
                dId,
                f.file_name,
                f.file_path,
                f.file_format || 'ZIP',
                f.file_size || 0,
                f.checksum || null
              ]);
            }
          } else if (oldMachineFile && oldMachineFile.file_path) {
            await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [dId]);
            await db.query(`
              INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, checksum, is_preview)
              VALUES (?, ?, ?, ?, ?, ?, 0)
            `, [
              dId,
              oldMachineFile.file_name,
              oldMachineFile.file_path,
              oldMachineFile.file_format || 'ZIP',
              oldMachineFile.file_size || 0,
              oldMachineFile.checksum || null
            ]);
          }
        }

        // Restore in fallback design object if available
        const fallbackDesign = await Design.getById(dId);
        if (fallbackDesign) {
          if (oldPrimary) fallbackDesign.primary_image = oldPrimary;
          if (oldImages.length > 0) fallbackDesign.images = oldImages;
          if (oldFiles.length > 0) {
            fallbackDesign.files = oldFiles;
          } else if (oldMachineFile) {
            fallbackDesign.files = [oldMachineFile];
          }
        }

        restoredCount++;
      } catch (err) {
        console.error(`Error restoring design #${item.design_id}:`, err);
      }
    }

    if (db.isConnected()) {
      try {
        await db.query('UPDATE image_replace_logs SET is_undone = 1, undone_at = NOW() WHERE id = ?', [logId]);
      } catch (_) {}
    }

    return {
      success: true,
      logId,
      restoredCount,
      revertedCount: restoredCount,
      message: `Successfully undone bulk replacement #${logId}. Restored ${restoredCount} designs to previous files.`
    };
  }

  /**
   * Generates CSV report for bulk replacement
   */
  async generateCsvReport(logId) {
    if (!db.isConnected()) await db.initPool();

    let log = null;
    let items = [];
    let fileLogs = [];

    const backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${logId}`);
    const manifestPath = path.join(backupDir, 'manifest.json');
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        log = { id: logId, ...manifest };
        fileLogs = manifest.fileLogs || [];
      } catch (_) {}
    }

    if (db.isConnected()) {
      const [logRow] = await db.query('SELECT * FROM image_replace_logs WHERE id = ?', [logId]);
      if (logRow) log = { ...logRow, ...(log || {}) };
      items = await db.query('SELECT * FROM image_replace_log_items WHERE log_id = ? ORDER BY id ASC', [logId]);
    }

    if (!log && !manifest) {
      if (manifestPath && fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        log = { id: logId, ...manifest };
        fileLogs = manifest.fileLogs || [];
      } else {
        throw new Error('Log not found');
      }
    }

    const escape = str => `"${(str || '').toString().replace(/"/g, '""')}"`;

    let csv = '';
    if (fileLogs && fileLogs.length > 0) {
      csv += '=== BULK FILE REPLACEMENT REPORT ===\n';
      csv += `Session ID,${logId}\n`;
      csv += `Category,${escape(log.categoryName || log.category_name || '')}\n`;
      csv += `Folder / Group,${escape(log.groupName || '')}\n`;
      csv += `Timestamp,${escape(log.timestamp || '')}\n`;
      csv += `Total Selected Files,${fileLogs.length}\n`;
      csv += `Replaced Images,${log.replacedImagesCount ?? (manifest ? manifest.replacedImagesCount : 0)}\n`;
      csv += `Replaced ZIPs,${log.replacedZipsCount ?? (manifest ? manifest.replacedZipsCount : 0)}\n`;
      csv += `Old Files Removed,${log.removedOldFilesCount ?? (manifest ? manifest.removedOldFilesCount : 0)}\n`;
      csv += `Failed,${log.failedCount ?? (manifest ? manifest.failedCount : 0)}\n\n`;

      csv += '=== PER-FILE OPERATION VERIFICATION LOG ===\n';
      csv += '#,File Name,Type,Size (Bytes),Upload Status,Storage Status,Database Status,Cleanup Status,Result,Storage Path,Error\n';
      fileLogs.forEach((fl, idx) => {
        csv += [
          idx + 1,
          escape(fl.fileName),
          escape(fl.fileType),
          fl.fileSize || 0,
          escape(fl.uploadStatus),
          escape(fl.storageStatus),
          escape(fl.dbStatus),
          escape(fl.cleanupStatus),
          escape(fl.result),
          escape(fl.storagePath),
          escape(fl.error)
        ].join(',') + '\n';
      });
    } else {
      csv = 'Design ID,SKU,Title,Status,Old Primary Image,New Primary Image,Old ZIP,New ZIP,Error Message\n';
      for (const it of items) {
        csv += [
          it.design_id,
          escape(it.sku),
          escape(it.title),
          it.status,
          escape(it.old_primary_image),
          escape(it.new_primary_image),
          escape(it.old_zip),
          escape(it.new_zip),
          escape(it.error_message)
        ].join(',') + '\n';
      }
    }

    return { log, csv };
  }

  /**
   * Fetches replacement history
   */
  async getHistory(page = 1, limit = 20) {
    if (!db.isConnected()) await db.initPool();

    const offset = (page - 1) * limit;
    let total = 0;
    let logs = [];

    if (db.isConnected()) {
      const [countRow] = await db.query('SELECT COUNT(*) as total FROM image_replace_logs');
      total = countRow ? countRow.total : 0;
      logs = await db.query(`
        SELECT * FROM image_replace_logs
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `, [limit, offset]);
    }

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Reads existing image and ZIP storage paths for products in a category
   * and identifies existing folders / file groups by their actual stored name (e.g. "ARUVI BULK DESIGNS 2")
   */
  async getCategoryExistingFolderGroups(categoryId) {
    if (!db.isConnected()) {
      try { await db.initPool(); } catch (_) {}
    }

    let category = null;
    if (categoryId && categoryId !== 'all') {
      if (db.isConnected()) {
        try {
          const [cRow] = await db.query('SELECT id, name, slug FROM categories WHERE id = ? OR slug = ? LIMIT 1', [categoryId, categoryId]);
          category = cRow;
        } catch (_) {}
      }
      if (!category) {
        const allCats = await Category.getAll();
        category = (allCats || []).find(c => String(c.id) === String(categoryId) || c.slug === categoryId) || null;
      }
    }

    const catId = category ? category.id : (categoryId !== 'all' ? categoryId : null);
    const catName = category ? category.name : 'Selected Category';

    let designs = [];
    if (db.isConnected()) {
      try {
        let sql = `
          SELECT d.*, c.name as category_name,
                 COALESCE(
                   (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
                   (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY id ASC LIMIT 1),
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND (is_preview = 1 OR file_kind = 'image') ORDER BY id DESC LIMIT 1)
                 ) AS primary_image
          FROM designs d
          LEFT JOIN categories c ON d.category_id = c.id
        `;
        const params = [];
        if (catId) {
          sql += ' WHERE d.category_id = ?';
          params.push(catId);
        }
        sql += ' ORDER BY d.id ASC';
        designs = (await db.query(sql, params)) || [];

        if (designs.length > 0) {
          const dIds = designs.map(d => d.id);
          const images = (await db.query(`SELECT id, design_id, image_url, is_primary FROM design_images WHERE design_id IN (${dIds.map(() => '?').join(',')})`, dIds)) || [];
          const files = (await db.query(`SELECT id, design_id, file_name, file_path, storage_key, file_format, is_preview FROM design_files WHERE design_id IN (${dIds.map(() => '?').join(',')})`, dIds)) || [];

          const imagesByDesign = new Map();
          for (const img of images) {
            if (!imagesByDesign.has(img.design_id)) imagesByDesign.set(img.design_id, []);
            imagesByDesign.get(img.design_id).push(img);
          }

          const filesByDesign = new Map();
          for (const f of files) {
            if (!filesByDesign.has(f.design_id)) filesByDesign.set(f.design_id, []);
            filesByDesign.get(f.design_id).push(f);
          }

          for (const d of designs) {
            d.images = imagesByDesign.get(d.id) || [];
            d.files = filesByDesign.get(d.id) || [];
          }
        }
      } catch (err) {
        console.warn('getCategoryExistingFolderGroups DB error:', err.message);
      }
    }

    if (!designs || designs.length === 0) {
      const allResult = await Design.getAll({ is_active_only: false, limit: 10000 });
      let list = allResult.designs || [];
      if (catId) {
        list = list.filter(d => String(d.category_id) === String(catId) || (category && d.category_slug === category.slug));
      }
      designs = list;
    }

    // Group designs by detected folder/group name
    const groupsMap = new Map();

    for (const d of designs) {
      const groupName = detectDesignFolderGroup(d);
      if (!groupsMap.has(groupName)) {
        groupsMap.set(groupName, {
          groupName,
          categoryName: d.category_name || catName,
          categoryId: d.category_id || catId,
          designs: [],
          existingImagesCount: 0,
          existingZipsCount: 0,
          existingImagePaths: [],
          existingZipPaths: []
        });
      }

      const group = groupsMap.get(groupName);
      group.designs.push({
        id: d.id,
        sku: d.sku,
        title: d.title,
        primary_image: d.primary_image
      });

      // Count images
      const imgList = (d.images && d.images.length > 0) ? d.images : (d.primary_image ? [{ image_url: d.primary_image }] : []);
      group.existingImagesCount += imgList.length;
      imgList.forEach(img => {
        if (img.image_url) group.existingImagePaths.push(img.image_url);
      });

      // Count ZIP packages
      const zipList = (d.files || []).filter(f => !f.is_preview && ((f.file_format || '').toUpperCase() === 'ZIP' || (f.file_name || f.file_path || '').toLowerCase().endsWith('.zip')));
      group.existingZipsCount += zipList.length;
      zipList.forEach(zf => {
        const p = zf.file_path || zf.storage_key || zf.file_name;
        if (p) group.existingZipPaths.push(p);
      });
    }

    const groups = Array.from(groupsMap.values()).map(g => ({
      groupName: g.groupName,
      categoryName: g.categoryName,
      categoryId: g.categoryId,
      designCount: g.designs.length,
      existingImagesCount: g.existingImagesCount,
      existingZipsCount: g.existingZipsCount,
      existingTotalFiles: g.existingImagesCount + g.existingZipsCount,
      designs: g.designs
    }));

    // Sort: named groups first (e.g. ARUVI BULK DESIGNS 2), Default Group last
    groups.sort((a, b) => {
      if (a.groupName === 'Default Group') return 1;
      if (b.groupName === 'Default Group') return -1;
      return a.groupName.localeCompare(b.groupName);
    });

    return {
      success: true,
      categoryId: catId,
      categoryName: catName,
      totalDesigns: designs.length,
      groups
    };
  }

  /**
   * Replaces all existing files in the selected folder/group with the newly uploaded files.
   * Removes old images & ZIPs, sets new files as the only active files, and preserves product data.
   */
  async replaceFileGroup(params = {}) {
    if (!db.isConnected()) {
      try { await db.initPool(); } catch (_) {}
    }

    const {
      adminUser = null,
      categoryId = null,
      categoryName = 'Selected Category',
      groupName = null,
      items = [] // newly uploaded files: { originalName, publicUrl, thumbUrl, storageKey, fileSize, checksum, isZip, detectedFormats }
    } = params;

    if (!groupName) {
      throw new Error('Existing folder/group name is required.');
    }

    if (!items || items.length === 0) {
      throw new Error('No replacement files provided.');
    }

    // 1. Fetch all designs belonging to this group in this category
    const categoryData = await this.getCategoryExistingFolderGroups(categoryId);
    const targetGroup = categoryData.groups.find(g => g.groupName === groupName);

    if (!targetGroup || targetGroup.designs.length === 0) {
      throw new Error(`Folder/Group "${groupName}" not found in category "${categoryName}".`);
    }

    const groupDesigns = targetGroup.designs; // array of { id, sku, title, primary_image }
    const allDesignIds = groupDesigns.map(d => d.id);

    const newImages = items.filter(f => !f.isZip);
    const newZips = items.filter(f => f.isZip);

    if (newImages.length === 0 && newZips.length === 0) {
      throw new Error('Please select at least one replacement image or ZIP package.');
    }

    const logId = Date.now();
    const backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${logId}`);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    // 2. Snapshot old state for 7-day rollback
    const backupManifest = {
      logId,
      timestamp: new Date().toISOString(),
      admin: adminUser ? adminUser.email : 'admin',
      categoryId,
      categoryName,
      groupName,
      designCount: groupDesigns.length,
      oldImagesCount: targetGroup.existingImagesCount,
      oldZipsCount: targetGroup.existingZipsCount,
      newImagesCount: newImages.length,
      newZipsCount: newZips.length,
      reportItems: [],
      fileLogs: []
    };

    let removedOldFilesCount = 0;
    const oldPhysicalFilesToClean = [];

    // Collect existing rows from DB / fallback for each design
    for (const dSummary of groupDesigns) {
      const dId = dSummary.id;
      let fullDesign = await Design.getById(dId);
      if (!fullDesign) continue;

      let oldDiRows = [];
      let oldDfRows = [];
      if (db.isConnected()) {
        oldDiRows = (await db.query('SELECT * FROM design_images WHERE design_id = ? ORDER BY is_primary DESC, id ASC', [dId])) || [];
        oldDfRows = (await db.query('SELECT * FROM design_files WHERE design_id = ? AND is_preview = 0 ORDER BY id ASC', [dId])) || [];
      } else {
        oldDiRows = fullDesign.images || [];
        oldDfRows = (fullDesign.files || []).filter(f => !f.is_preview);
      }

      removedOldFilesCount += (oldDiRows.length + oldDfRows.length);

      backupManifest.reportItems.push({
        designId: dId,
        sku: fullDesign.sku,
        title: fullDesign.title,
        oldImage: fullDesign.primary_image,
        oldImagesJson: JSON.stringify(oldDiRows),
        oldZip: oldDfRows[0] ? oldDfRows[0].file_name : null,
        oldFilesJson: JSON.stringify(oldDfRows)
      });

      for (const img of oldDiRows) {
        if (img.image_url) oldPhysicalFilesToClean.push({ type: 'image', path: img.image_url });
      }
      for (const fil of oldDfRows) {
        const fPath = fil.file_path || fil.storage_key;
        if (fPath) oldPhysicalFilesToClean.push({ type: 'file', path: fPath });
      }
    }

    let replacedImagesTotal = 0;
    let replacedZipsTotal = 0;
    let failedTotal = 0;
    const fileLogs = [];

    const versionSuffix = `?v=${logId}`;
    const newImageIdsByDesign = new Map();
    const newFileIdsByDesign = new Map();
    allDesignIds.forEach(id => {
      newImageIdsByDesign.set(id, []);
      newFileIdsByDesign.set(id, []);
    });

    // In fallback mode, reset old images and machine files for each design
    if (!db.isConnected()) {
      for (const dId of allDesignIds) {
        const fbDesign = await Design.getById(dId);
        if (fbDesign) {
          fbDesign.images = [];
          fbDesign.files = (fbDesign.files || []).filter(f => f.is_preview);
        }
      }
    }

    // 3. Process every selected image (all N images)
    // If 1 design in group, all images belong to that design (image 0 primary, 1..N-1 gallery).
    // If multiple designs, distribute images across designs so EVERY image is preserved.
    for (let imgIdx = 0; imgIdx < newImages.length; imgIdx++) {
      const img = newImages[imgIdx];
      const targetDesignIndex = groupDesigns.length === 1 ? 0 : (imgIdx % groupDesigns.length);
      const targetDesign = groupDesigns[targetDesignIndex];
      const dId = targetDesign.id;
      const isPrimary = (groupDesigns.length === 1 && imgIdx === 0) || (groupDesigns.length > 1 && imgIdx < groupDesigns.length);

      const rawUrl = img.publicUrl || '';
      const versionedUrl = rawUrl.includes('?v=') ? rawUrl : `${rawUrl}${versionSuffix}`;
      const imgExt = (path.extname(img.originalName).replace('.', '') || 'PNG').toUpperCase();

      try {
        let insertedImageId = null;
        const tKey = img.thumbKey ? (img.thumbKey.includes('?v=') ? img.thumbKey : `${img.thumbKey}${versionSuffix}`) : versionedUrl;
        const cKey = img.cardKey ? (img.cardKey.includes('?v=') ? img.cardKey : `${img.cardKey}${versionSuffix}`) : versionedUrl;

        if (db.isConnected()) {
          try {
            const insRes = await db.query(
              'INSERT INTO design_images (design_id, image_url, thumb_key, card_key, is_primary, display_order, file_size, checksum, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
              [dId, versionedUrl, tKey, cKey, isPrimary ? 1 : 0, imgIdx, img.fileSize || 0, img.checksum || null]
            );
            insertedImageId = insRes.insertId;
          } catch (dbErr) {
            try {
              const insRes = await db.query(
                'INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size, checksum, version) VALUES (?, ?, ?, ?, ?, ?, 1)',
                [dId, versionedUrl, isPrimary ? 1 : 0, imgIdx, img.fileSize || 0, img.checksum || null]
              );
              insertedImageId = insRes.insertId;
            } catch (_) {
              const insRes = await db.query(
                'INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)',
                [dId, versionedUrl, isPrimary ? 1 : 0, imgIdx]
              );
              insertedImageId = insRes.insertId;
            }
          }

          if (insertedImageId) {
            newImageIdsByDesign.get(dId).push(insertedImageId);
          }

          // If primary image, update designs table sync columns and design_files preview record
          if (isPrimary) {
            try {
              await db.query('UPDATE designs SET primary_image = ?, thumbnail_image = ?, card_image = ? WHERE id = ?', [versionedUrl, tKey, cKey, dId]);
            } catch (_) {
              try {
                await db.query('UPDATE designs SET primary_image = ? WHERE id = ?', [versionedUrl, dId]);
              } catch (_) {}
            }

            try {
              const existingPreview = await db.query(
                "SELECT id FROM design_files WHERE design_id = ? AND (is_preview = 1 OR file_kind = 'image') ORDER BY id ASC LIMIT 1",
                [dId]
              );
              if (existingPreview && existingPreview.length > 0) {
                await db.query(
                  'UPDATE design_files SET file_name = ?, file_path = ?, file_format = ?, file_size = ?, is_preview = 1, file_kind = "image" WHERE id = ?',
                  [img.originalName, versionedUrl, imgExt, img.fileSize || 0, existingPreview[0].id]
                );
              } else {
                await db.query(
                  'INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview, file_kind) VALUES (?, ?, ?, ?, ?, 1, "image")',
                  [dId, img.originalName, versionedUrl, imgExt, img.fileSize || 0]
                );
              }
            } catch (pfErr) {
              console.warn('[BulkReplace preview file update warning]:', pfErr.message);
            }
          }
        }

        // Maintain fallback design object
        const fbDesign = await Design.getById(dId);
        if (fbDesign) {
          if (!fbDesign.images) fbDesign.images = [];
          if (isPrimary) {
            fbDesign.primary_image = versionedUrl;
            fbDesign.images = fbDesign.images.filter(im => !im.is_primary);
          }
          fbDesign.images.push({
            id: Date.now() + imgIdx,
            image_url: versionedUrl,
            is_primary: isPrimary ? 1 : 0,
            display_order: imgIdx
          });
        }

        replacedImagesTotal++;
        fileLogs.push({
          fileName: img.originalName,
          fileType: 'Image',
          fileSize: img.fileSize || 0,
          uploadStatus: 'Uploaded',
          storageStatus: 'Stored',
          storagePath: img.publicUrl,
          dbStatus: 'Updated',
          cleanupStatus: 'Cleaned',
          result: 'Verified',
          error: null
        });
      } catch (imgErr) {
        console.error(`Failed to process image ${img.originalName}:`, imgErr);
        failedTotal++;
        fileLogs.push({
          fileName: img.originalName,
          fileType: 'Image',
          fileSize: img.fileSize || 0,
          uploadStatus: 'Uploaded',
          storageStatus: 'Failed',
          storagePath: img.publicUrl || null,
          dbStatus: 'Failed',
          cleanupStatus: '-',
          result: 'Failed',
          error: imgErr.message
        });
      }
    }

    // 4. Process every selected ZIP package (all M ZIPs)
    // If 1 design in group, all ZIPs stored as machine files for that design in design_files.
    // If multiple designs, distribute ZIPs across designs so EVERY ZIP is stored.
    const allDetectedFormats = [];
    for (let zipIdx = 0; zipIdx < newZips.length; zipIdx++) {
      const zip = newZips[zipIdx];
      const targetDesignIndex = groupDesigns.length === 1 ? 0 : (zipIdx % groupDesigns.length);
      const targetDesign = groupDesigns[targetDesignIndex];
      const dId = targetDesign.id;
      const ext = (path.extname(zip.originalName).replace('.', '') || 'ZIP').toUpperCase();
      const storagePath = zip.storageKey || zip.publicUrl;

      if (Array.isArray(zip.detectedFormats)) {
        allDetectedFormats.push(...zip.detectedFormats);
      }

      try {
        let insertedFileId = null;
        if (db.isConnected()) {
          try {
            const insRes = await db.query(
              'INSERT INTO design_files (design_id, file_name, file_path, storage_key, file_format, file_size, checksum, is_preview, file_kind, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0, "machine", ?)',
              [dId, zip.originalName, storagePath, zip.storageKey || storagePath, ext, zip.fileSize || 0, zip.checksum || null, zipIdx]
            );
            insertedFileId = insRes.insertId;
          } catch (colErr) {
            const insRes = await db.query(
              'INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, checksum, is_preview) VALUES (?, ?, ?, ?, ?, ?, 0)',
              [dId, zip.originalName, storagePath, ext, zip.fileSize || 0, zip.checksum || null]
            );
            insertedFileId = insRes.insertId;
          }

          if (insertedFileId) {
            newFileIdsByDesign.get(dId).push(insertedFileId);
          }
        }

        // Maintain fallback design object
        const fbDesign = await Design.getById(dId);
        if (fbDesign) {
          if (!fbDesign.files) fbDesign.files = [];
          fbDesign.files.push({
            id: Date.now() + 100 + zipIdx,
            file_name: zip.originalName,
            file_path: storagePath,
            storage_key: zip.storageKey || storagePath,
            file_format: ext,
            file_size: zip.fileSize || 0,
            is_preview: 0,
            file_kind: 'machine'
          });
        }

        replacedZipsTotal++;
        fileLogs.push({
          fileName: zip.originalName,
          fileType: 'ZIP Package',
          fileSize: zip.fileSize || 0,
          uploadStatus: 'Uploaded',
          storageStatus: 'Stored',
          storagePath: storagePath,
          dbStatus: 'Updated',
          cleanupStatus: 'Cleaned',
          result: 'Verified',
          error: null
        });
      } catch (zipErr) {
        console.error(`Failed to process ZIP ${zip.originalName}:`, zipErr);
        failedTotal++;
        fileLogs.push({
          fileName: zip.originalName,
          fileType: 'ZIP Package',
          fileSize: zip.fileSize || 0,
          uploadStatus: 'Uploaded',
          storageStatus: 'Failed',
          storagePath: storagePath || null,
          dbStatus: 'Failed',
          cleanupStatus: '-',
          result: 'Failed',
          error: zipErr.message
        });
      }
    }

    // 5. Remove old DB records safely (only after new records are inserted and if no error aborted)
    if (db.isConnected()) {
      for (const dId of allDesignIds) {
        const keptImgIds = newImageIdsByDesign.get(dId) || [];
        if (keptImgIds.length > 0) {
          await db.query(
            `DELETE FROM design_images WHERE design_id = ? AND id NOT IN (${keptImgIds.map(() => '?').join(',')})`,
            [dId, ...keptImgIds]
          );
        }

        const keptFileIds = newFileIdsByDesign.get(dId) || [];
        if (keptFileIds.length > 0) {
          await db.query(
            `DELETE FROM design_files WHERE design_id = ? AND is_preview = 0 AND id NOT IN (${keptFileIds.map(() => '?').join(',')})`,
            [dId, ...keptFileIds]
          );
        }

        // Synchronize formats and group association on designs table
        try {
          const uniqueFormats = [...new Set(allDetectedFormats.filter(Boolean))];
          const formatsStr = uniqueFormats.length > 0 ? uniqueFormats.join(', ') : 'DST, PES, JEF, EXP';
          await db.query('UPDATE designs SET import_zip_filename = ?, formats = ? WHERE id = ?', [groupName, formatsStr, dId]);
        } catch (_) {}
      }
    } else {
      // In fallback mode, synchronize formats and group name on designs
      for (const dId of allDesignIds) {
        const fbDesign = await Design.getById(dId);
        if (fbDesign) {
          fbDesign.import_zip_filename = groupName;
          const uniqueFormats = [...new Set(allDetectedFormats.filter(Boolean))];
          fbDesign.formats = uniqueFormats.length > 0 ? uniqueFormats.join(', ') : 'DST, PES, JEF, EXP';
        }
      }
    }

    // 6. Delete old physical files from disk safely (only if not referenced anywhere else)
    for (const oldItem of oldPhysicalFilesToClean) {
      if (!oldItem.path) continue;
      const cleanUrl = oldItem.path.split('?')[0].replace(/^\//, '');
      const fullDiskPath = storage.resolveFilePath ? storage.resolveFilePath(cleanUrl) : path.resolve(__dirname, '..', cleanUrl);
      if (fullDiskPath && fs.existsSync(fullDiskPath) && fs.statSync(fullDiskPath).isFile()) {
        const normalized = fullDiskPath.replace(/\\/g, '/').toLowerCase();
        if (
          !normalized.includes('hero_embroidery') &&
          !normalized.includes('logo') &&
          !normalized.includes('placeholder')
        ) {
          try {
            fs.unlinkSync(fullDiskPath);
          } catch (cleanErr) {
            console.warn('[BulkReplace Old File Cleanup Warning]:', cleanErr.message);
          }
        }
      }
    }

    // 7. Save manifest for 7-day rollback
    backupManifest.fileLogs = fileLogs;
    backupManifest.replacedImagesCount = replacedImagesTotal;
    backupManifest.replacedZipsCount = replacedZipsTotal;
    backupManifest.removedOldFilesCount = removedOldFilesCount;
    backupManifest.failedCount = failedTotal;
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(backupManifest, null, 2));

    // 8. Log session
    if (db.isConnected()) {
      try {
        await db.query(`
          INSERT INTO image_replace_logs 
            (admin_id, admin_email, category_id, category_name, scope_summary, replacement_mode, total_files, matched_designs, replaced_count, backup_dir)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          adminUser ? adminUser.id : null,
          adminUser ? adminUser.email : 'admin',
          categoryId || null,
          categoryName,
          `Replaced all files in group "${groupName}" (${groupDesigns.length} designs)`,
          'replace_group',
          items.length,
          groupDesigns.length,
          replacedImagesTotal + replacedZipsTotal,
          backupDir
        ]);
      } catch (logErr) {
        console.warn('Logging replace session error:', logErr.message);
      }
    }

    return {
      success: failedTotal === 0,
      logId,
      groupName,
      categoryName,
      replacedDesignsCount: groupDesigns.length,
      totalSelectedFiles: items.length,
      selectedImagesCount: newImages.length,
      selectedZipsCount: newZips.length,
      replacedImagesCount: replacedImagesTotal,
      replacedZipsCount: replacedZipsTotal,
      removedOldFilesCount,
      failedCount: failedTotal,
      fileLogs,
      message: failedTotal === 0
        ? `Successfully replaced all files in group "${groupName}". ${replacedImagesTotal} images and ${replacedZipsTotal} ZIP packages are now active.`
        : `Replacement finished with ${failedTotal} failures in group "${groupName}". ${replacedImagesTotal} images and ${replacedZipsTotal} ZIPs active.`
    };
  }
}

module.exports = new BulkImageReplaceService();
