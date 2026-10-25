const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Design = require('../../models/Design');
const Category = require('../../models/Category');
const Setting = require('../../models/Setting');
const db = require('../../config/db');
const emailService = require('../../services/emailService');
const storage = require('../../config/storage');
const { getPreviewsDir, getDesignsDir, resolveFilePath, fileExists, getStorageDriver, uploadToCloudinary, uploadToS3OrR2 } = storage;
const ActivityLog = require('../../models/ActivityLog');
const User = require('../../models/User');
const bulkPriceService = require('../../services/bulkPriceService');
const bulkDesignDetailsService = require('../../services/bulkDesignDetailsService');
const { runBackup } = require('../../scripts/backup');

const AdminStatsService = require('../../services/adminStatsService');
const errorLogger = require('../../services/errorLogger');

exports.getDesigns = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { search, category, status, sort, fileFilter } = req.query;

    let categoryId = null;
    let categorySlug = null;
    if (category) {
      const cat = await Category.getBySlug(category);
      if (cat) categoryId = cat.id;
      else categorySlug = category;
    }

    const { designs, total, totalPages } = await Design.getAll({
      is_active_only: false,
      search: search || '',
      category_id: categoryId,
      category_slug: categorySlug,
      status: status || null,
      fileFilter: fileFilter || null,
      sort: sort || 'newest',
      page,
      limit: 15
    });

    const categories = await Category.getAll();
    const stats = await AdminStatsService.getDesignStats();

    res.render('admin/designs/index', {
      title: 'Manage Embroidery Designs - Admin',
      designs,
      categories,
      total: (search || category || status || fileFilter) ? total : stats.totalDesigns,
      activeCount: stats.activeDesigns,
      inactiveCount: stats.inactiveDesigns,
      categoryCount: stats.totalCategories,
      stats,
      currentPage: page,
      totalPages: totalPages || 1,
      search: search || '',
      selectedCategory: category || '',
      selectedStatus: status || '',
      selectedSort: sort || 'newest',
      selectedFileFilter: fileFilter || ''
    });
  } catch (err) {
    next(err);
  }
};

const AdmZip = require('adm-zip');

exports.processUploadedFilesAndArchives = processUploadedFilesAndArchives;

/**
 * Inspects uploaded files, ZIP archives, and folder drops to extract valid machine format files.
 * Protects against Zip Slip path traversal and enforces file size limits.
 */
function processUploadedFilesAndArchives(reqFiles) {
  const packageFiles = [];
  const targetDir = getDesignsDir();

  if (!reqFiles) return packageFiles;

  const allFilesList = [];
  if (Array.isArray(reqFiles)) {
    allFilesList.push(...reqFiles);
  } else if (typeof reqFiles === 'object') {
    Object.keys(reqFiles).forEach(key => {
      if (Array.isArray(reqFiles[key])) {
        allFilesList.push(...reqFiles[key]);
      } else if (reqFiles[key]) {
        allFilesList.push(reqFiles[key]);
      }
    });
  }

  for (const file of allFilesList) {
    const extName = path.extname(file.originalname).toLowerCase();
    
    // Ignore preview image files here (handled separately)
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(extName)) {
      continue;
    }

    if (extName === '.zip') {
      try {
        console.log(`[ZIP PACKAGE PROCESS] Reading archive "${file.originalname}"...`);
        const zip = new AdmZip(file.path);
        const entries = zip.getEntries();

        const machineEntries = entries.filter(e => {
          if (e.isDirectory) return false;
          const eExt = path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase();
          return ['DST', 'PES', 'JEF', 'EXP'].includes(eExt);
        });

        const fileCount = machineEntries.length > 0 ? machineEntries.length : (entries.filter(e => !e.isDirectory).length || 1);
        const detectedFormats = [...new Set(machineEntries.map(e => path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase()))];
        if (detectedFormats.length === 0) detectedFormats.push('DST');

        const uniqueZipFilename = `zip_pkg_${Date.now()}_${Math.round(Math.random() * 10000)}_${path.basename(file.originalname)}`;
        const destPath = path.join(targetDir, uniqueZipFilename);

        fs.copyFileSync(file.path, destPath);

        packageFiles.push({
          originalname: file.originalname,
          filename: uniqueZipFilename,
          path: destPath,
          webPath: `/public/uploads/designs/${uniqueZipFilename}`,
          size: file.size,
          format: 'ZIP',
          fileCount: fileCount,
          detectedFormats: detectedFormats,
          source: 'zip'
        });

        console.log(`[ZIP PACKAGE SAVED] ${file.originalname} -> ${uniqueZipFilename} (${fileCount} machine files, formats: ${detectedFormats.join(', ')})`);
      } catch (zipErr) {
        console.error('[ZIP PROCESSING ERROR]:', zipErr);
        throw new Error(`Failed to process uploaded ZIP archive "${file.originalname}": ${zipErr.message}`);
      }
    } else if (['.dst', '.pes', '.jef', '.exp'].includes(extName)) {
      const fmtUpper = extName.replace('.', '').toUpperCase();
      const uniqueFilename = `pkg_${fmtUpper.toLowerCase()}_${Date.now()}_${path.basename(file.originalname)}`;
      const destPath = path.join(targetDir, uniqueFilename);
      fs.copyFileSync(file.path, destPath);

      packageFiles.push({
        originalname: file.originalname,
        filename: uniqueFilename,
        path: destPath,
        webPath: `/public/uploads/designs/${uniqueFilename}`,
        size: file.size,
        format: fmtUpper,
        fileCount: 1,
        detectedFormats: [fmtUpper],
        source: 'direct'
      });
    }
  }

  return packageFiles;
}

exports.getNextSku = async (req, res, next) => {
  try {
    const categoryId = req.query.category_id;
    const currentId = req.query.current_id || null;
    if (!categoryId) {
      return res.status(400).json({ success: false, message: 'Category ID is required' });
    }
    const nextSku = await Design.getNextSkuForCategory(categoryId, currentId);
    return res.json({ success: true, sku: nextSku });
  } catch (err) {
    console.error('[getNextSku error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getCreateForm = async (req, res, next) => {
  try {
    const categories = await Category.getAll();
    const suggestedReviewCount = 0;
    let defaultSku = 'AED-GEN-01';
    if (categories && categories.length > 0) {
      defaultSku = await Design.getNextSkuForCategory(categories[0].id);
    }
    res.render('admin/designs/form', {
      title: 'Add New Embroidery Design - Admin',
      design: null,
      categories,
      suggestedReviewCount,
      defaultSku
    });
  } catch (err) {
    next(err);
  }
};

function checkIsAjax(req) {
  if (!req) return false;
  if (req.xhr) return true;
  const headers = req.headers || {};
  const acceptHeader = String((typeof req.get === 'function' ? req.get('accept') : headers['accept']) || headers['accept'] || '').toLowerCase();
  if (acceptHeader.includes('json')) return true;

  const requestedWith = String((typeof req.get === 'function' ? req.get('x-requested-with') : headers['x-requested-with']) || headers['x-requested-with'] || '').toLowerCase();
  if (requestedWith.includes('xmlhttprequest')) return true;

  if (req.query && (req.query.format === 'json' || req.query.ajax === '1' || req.query.is_ajax === '1')) return true;
  if (req.body && (req.body.is_ajax === '1' || req.body.ajax === '1')) return true;

  return false;
}

function validateStitchCount(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { valid: true, value: null };
  }
  const clean = String(value).replace(/,/g, '').trim();
  if (!/^\d+$/.test(clean)) {
    return { valid: false, error: `${fieldName} must be a non-negative whole number (e.g. 12500).` };
  }
  const num = parseInt(clean, 10);
  if (num < 0) {
    return { valid: false, error: `${fieldName} must be a non-negative whole number.` };
  }
  return { valid: true, value: num };
}

exports.postCreate = async (req, res, next) => {
  try {
    console.log('[PUBLISH] Request received for design creation:', req.body.title);
    const {
      title, sku, slug, price, sale_price, category_id,
      hoop_size, stitch_count, stitch_count_front, stitch_count_back, stitch_count_sleeve, description,
      dimensions, formats, is_featured, is_trending, is_active, download_count, tags, status_draft,
      average_rating, reviews_count
    } = req.body;

    const isAjax = checkIsAjax(req);

    if (!title || price === undefined || price === null || price === '') {
      const errMsg = 'Design Name and Original Price (MRP) are required.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    const mrp = parseFloat(price);
    const sellingPrice = (sale_price !== undefined && sale_price !== null && sale_price !== '') ? parseFloat(sale_price) : null;

    if (isNaN(mrp) || mrp < 0) {
      const errMsg = 'Original Price (MRP) must be a non-negative number.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    if (sellingPrice !== null && (isNaN(sellingPrice) || sellingPrice < 0)) {
      const errMsg = 'Final Selling Price must be a non-negative number.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    if (sellingPrice !== null && sellingPrice > mrp) {
      const errMsg = 'Final Selling Price cannot exceed Original Price (MRP).';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    // Validate Stitch Counts
    const frontCheck = validateStitchCount(stitch_count_front, 'Front Stitch Count');
    if (!frontCheck.valid) {
      if (isAjax) return res.status(400).json({ success: false, message: frontCheck.error });
      req.flash('error', frontCheck.error);
      return res.redirect('back');
    }
    const backCheck = validateStitchCount(stitch_count_back, 'Back Stitch Count');
    if (!backCheck.valid) {
      if (isAjax) return res.status(400).json({ success: false, message: backCheck.error });
      req.flash('error', backCheck.error);
      return res.redirect('back');
    }
    const sleeveCheck = validateStitchCount(stitch_count_sleeve, 'Sleeve Stitch Count');
    if (!sleeveCheck.valid) {
      if (isAjax) return res.status(400).json({ success: false, message: sleeveCheck.error });
      req.flash('error', sleeveCheck.error);
      return res.redirect('back');
    }

    // SKU Auto-generation & Uniqueness Validation
    let finalSku = (sku && sku.trim()) ? sku.trim() : null;
    if (finalSku) {
      const isDuplicate = await Design.isSkuExists(finalSku);
      if (isDuplicate) {
        const isAutoPattern = /^AED-[A-Z]{2,4}-\d+$/i.test(finalSku);
        if (isAutoPattern) {
          // Resolve simultaneous product creation safely with next available sequence
          finalSku = await Design.getNextSkuForCategory(category_id);
        } else {
          const errMsg = `Design Code / SKU "${finalSku}" is already in use by another product. Please enter a unique SKU.`;
          if (isAjax) return res.status(400).json({ success: false, message: errMsg });
          req.flash('error', errMsg);
          return res.redirect('back');
        }
      }
    } else {
      finalSku = await Design.getNextSkuForCategory(category_id);
    }

    // Rating & review count validation
    let parsedRating = average_rating !== undefined && average_rating !== '' ? parseFloat(average_rating) : 4.80;
    if (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
      const errMsg = 'Rating must be between 0 and 5.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    let parsedReviews = reviews_count !== undefined && reviews_count !== '' ? parseInt(reviews_count) : 0;
    if (isNaN(parsedReviews) || parsedReviews < 0 || parsedReviews > 149) {
      const errMsg = 'Review count must be an integer between 0 and 149.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    const finalActiveState = status_draft ? 0 : (is_active ? 1 : 0);
    
    // Process uploaded ZIP package
    const packageFiles = processUploadedFilesAndArchives(req.files);

    const baseSlugInput = (slug && slug.trim()) ? slug : title;
    const finalSlug = await Design.generateUniqueSlug(baseSlugInput);

    let detectedFormatsStr = 'DST';
    if (packageFiles.length > 0) {
      detectedFormatsStr = packageFiles[0].detectedFormats ? packageFiles[0].detectedFormats.join(', ') : 'DST';
    }

    const designId = await Design.create({
      title,
      sku: finalSku,
      slug: finalSlug,
      price: mrp,
      sale_price: sellingPrice,
      category_id: category_id ? parseInt(category_id) : null,
      hoop_size: hoop_size || null,
      stitch_count: stitch_count ? parseInt(stitch_count) : null,
      stitch_count_front: frontCheck.value,
      stitch_count_back: backCheck.value,
      stitch_count_sleeve: sleeveCheck.value,
      description: description !== undefined ? description : null,
      dimensions: dimensions || null,
      formats: detectedFormatsStr,
      is_featured: is_featured ? 1 : 0,
      is_trending: is_trending ? 1 : 0,
      is_active: finalActiveState,
      download_count: download_count ? parseInt(download_count) : 0,
      tags: tags || null,
      average_rating: parsedRating,
      reviews_count: parsedReviews
    });

    // Save single ZIP package record in design_files
    if (packageFiles.length > 0) {
      const pkg = packageFiles[0];
      await Design.addFile(designId, pkg.originalname, pkg.webPath, 'ZIP', pkg.size, 0);
    }

    // Handle uploaded preview images
    if (req.files) {
      const allFilesList = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
      const imgFiles = allFilesList.filter(file => {
        const ext = path.extname(file.originalname).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
      });

      for (const file of imgFiles) {
        const extName = path.extname(file.originalname).toLowerCase();
        const ext = extName.replace('.', '').toUpperCase();
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
        await Design.addFile(designId, file.originalname, savedUrl, ext, file.size, 1);
      }
    }

    await Design.syncDesignFormats(designId);

    // Note: Automatic campaign emails on design creation disabled per requirement

    const statusMsg = finalActiveState === 1 ? 'published' : 'saved as draft';
    console.log(`[PUBLISH SUCCESS] Design #${designId} "${title}" ${statusMsg} successfully.`);
    await ActivityLog.logFromReq(req, 'create', 'design', designId, `Created design #${designId} "${title}" (SKU: ${finalSku})`);

    if (isAjax) {
      return res.json({
        success: true,
        message: `Design "${title}" ${statusMsg} successfully!`,
        designId,
        redirectUrl: '/admin/designs'
      });
    }

    req.flash('success', `Design "${title}" ${statusMsg} successfully!`);
    res.redirect('/admin/designs');
  } catch (err) {
    console.error('[PUBLISH CREATE ERROR]:', err);
    const isAjax = checkIsAjax(req);
    if (isAjax) {
      return res.status(400).json({ success: false, message: err.message || 'Unable to create design.' });
    }
    req.flash('error', `Unable to create design: ${err.message}`);
    res.redirect('back');
  }
};

exports.getEditForm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const design = await Design.getById(id);
    const categories = await Category.getAll();

    if (!design) {
      req.flash('error', 'Design not found.');
      return res.redirect('/admin/designs');
    }

    res.render('admin/designs/form', {
      title: `Edit ${design.title} - Admin`,
      design,
      categories
    });
  } catch (err) {
    next(err);
  }
};

exports.postEdit = async (req, res, next) => {
  try {
    const { id } = req.params;
    console.log(`[PUBLISH] Request received for design #${id} edit`);
    const {
      title, sku, slug, price, sale_price, category_id,
      hoop_size, stitch_count, stitch_count_front, stitch_count_back, stitch_count_sleeve, description,
      dimensions, formats, is_featured, is_trending, is_active, download_count, tags, status_draft, selected_formats,
      average_rating, reviews_count
    } = req.body;

    const isAjax = checkIsAjax(req);

    if (!title || price === undefined || price === null || price === '') {
      const errMsg = 'Design Name and Original Price (MRP) are required.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    const mrp = parseFloat(price);
    const sellingPrice = (sale_price !== undefined && sale_price !== null && sale_price !== '') ? parseFloat(sale_price) : null;

    if (isNaN(mrp) || mrp < 0) {
      const errMsg = 'Original Price (MRP) must be a non-negative number.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    if (sellingPrice !== null && (isNaN(sellingPrice) || sellingPrice < 0)) {
      const errMsg = 'Final Selling Price must be a non-negative number.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    if (sellingPrice !== null && sellingPrice > mrp) {
      const errMsg = 'Final Selling Price cannot exceed Original Price (MRP).';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    // Validate Stitch Counts
    const frontCheck = validateStitchCount(stitch_count_front, 'Front Stitch Count');
    if (!frontCheck.valid) {
      if (isAjax) return res.status(400).json({ success: false, message: frontCheck.error });
      req.flash('error', frontCheck.error);
      return res.redirect('back');
    }
    const backCheck = validateStitchCount(stitch_count_back, 'Back Stitch Count');
    if (!backCheck.valid) {
      if (isAjax) return res.status(400).json({ success: false, message: backCheck.error });
      req.flash('error', backCheck.error);
      return res.redirect('back');
    }
    const sleeveCheck = validateStitchCount(stitch_count_sleeve, 'Sleeve Stitch Count');
    if (!sleeveCheck.valid) {
      if (isAjax) return res.status(400).json({ success: false, message: sleeveCheck.error });
      req.flash('error', sleeveCheck.error);
      return res.redirect('back');
    }

    const existingDesign = await Design.getById(id);
    if (!existingDesign) {
      const errMsg = 'Design record not found.';
      if (isAjax) return res.status(404).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('/admin/designs');
    }

    // SKU Uniqueness Validation
    let finalSku = (sku && sku.trim()) ? sku.trim() : existingDesign.sku;
    if (finalSku) {
      const isDuplicate = await Design.isSkuExists(finalSku, id);
      if (isDuplicate) {
        const errMsg = `Design Code / SKU "${finalSku}" is already in use by another product. Please enter a unique SKU.`;
        if (isAjax) return res.status(400).json({ success: false, message: errMsg });
        req.flash('error', errMsg);
        return res.redirect('back');
      }
    }

    // Rating & review count validation
    let parsedRating = average_rating !== undefined && average_rating !== '' ? parseFloat(average_rating) : undefined;
    if (parsedRating !== undefined && (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5)) {
      const errMsg = 'Rating must be between 0 and 5.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    let parsedReviews = reviews_count !== undefined && reviews_count !== '' ? parseInt(reviews_count) : undefined;
    if (parsedReviews !== undefined && (isNaN(parsedReviews) || parsedReviews < 0 || parsedReviews > 149)) {
      const errMsg = 'Review count must be an integer between 0 and 149.';
      if (isAjax) return res.status(400).json({ success: false, message: errMsg });
      req.flash('error', errMsg);
      return res.redirect('back');
    }

    const finalActiveState = status_draft ? 0 : (is_active ? 1 : 0);

    // Process uploaded ZIP package
    const packageFiles = processUploadedFilesAndArchives(req.files);

    let baseSlugInput = (slug && slug.trim()) ? slug.trim() : (existingDesign.slug || title || `design-${id}`);
    const finalSlug = await Design.generateUniqueSlug(baseSlugInput, id);

    await Design.update(id, {
      title,
      sku: finalSku,
      slug: finalSlug,
      price: mrp,
      sale_price: sellingPrice,
      category_id: category_id ? parseInt(category_id) : null,
      hoop_size: hoop_size || existingDesign.hoop_size || null,
      stitch_count: (stitch_count !== undefined && stitch_count !== '') ? parseInt(stitch_count) : (existingDesign.stitch_count || null),
      stitch_count_front: frontCheck.value !== undefined ? frontCheck.value : (existingDesign.stitch_count_front || null),
      stitch_count_back: backCheck.value !== undefined ? backCheck.value : (existingDesign.stitch_count_back || null),
      stitch_count_sleeve: sleeveCheck.value !== undefined ? sleeveCheck.value : (existingDesign.stitch_count_sleeve || null),
      description: description !== undefined ? description : (existingDesign.description || null),
      dimensions: dimensions || existingDesign.dimensions || null,
      formats: formats || existingDesign.formats || '',
      is_featured: is_featured ? 1 : 0,
      is_trending: is_trending ? 1 : 0,
      is_active: finalActiveState,
      download_count: (download_count !== undefined && download_count !== '') ? parseInt(download_count) : (existingDesign.download_count || 0),
      tags: tags || null,
      average_rating: parsedRating,
      reviews_count: parsedReviews
    });

    // Save single ZIP package record if new ZIP file uploaded
    if (packageFiles.length > 0) {
      const pkg = packageFiles[0];
      if (fs.existsSync(pkg.path)) {
        const db = require('../../config/db');
        if (db.isConnected()) {
          await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [id]);
        }
        await Design.addFile(id, pkg.originalname, pkg.webPath, 'ZIP', pkg.size, 0);
        const detectedFormatsStr = pkg.detectedFormats ? pkg.detectedFormats.join(', ') : 'DST';
        await Design.update(id, { formats: detectedFormatsStr });
      }
    }

    // Handle uploaded preview images
    if (req.files) {
      const allFilesList = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
      const imgFiles = allFilesList.filter(file => {
        const ext = path.extname(file.originalname).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
      });

      for (const file of imgFiles) {
        const extName = path.extname(file.originalname).toLowerCase();
        const ext = extName.replace('.', '').toUpperCase();
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
        await Design.addFile(id, file.originalname, savedUrl, ext, file.size, 1);
      }
    }

    await Design.syncDesignFormats(id);

    // Note: Automatic campaign emails on design update disabled per requirement

    const statusMsg = finalActiveState === 1 ? 'published' : 'saved as draft';
    console.log(`[PUBLISH SUCCESS] Design #${id} "${title}" updated and ${statusMsg} successfully.`);
    await ActivityLog.logFromReq(req, 'update', 'design', id, `Updated design #${id} "${title}"`);

    if (isAjax) {
      return res.json({
        success: true,
        message: `Design "${title}" updated and ${statusMsg} successfully.`,
        designId: id,
        redirectUrl: '/admin/designs'
      });
    }

    req.flash('success', `Design "${title}" updated and ${statusMsg} successfully.`);
    res.redirect(`/admin/designs/edit/${id}`);
  } catch (err) {
    console.error('[PUBLISH EDIT ERROR]:', err);
    const isAjax = checkIsAjax(req);
    if (isAjax) {
      return res.status(400).json({ success: false, message: err.message || 'Unable to update design.' });
    }
    req.flash('error', `Unable to update design: ${err.message}`);
    res.redirect('back');
  }
};

exports.toggleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const design = await Design.getById(id);
    if (!design) {
      return res.status(404).json({ success: false, message: 'Design not found' });
    }

    const newStatus = design.is_active ? 0 : 1;
    await Design.updateStatus(id, newStatus);
    await ActivityLog.logFromReq(req, 'update_status', 'design', id, `Changed design #${id} "${design.title}" status to ${newStatus ? 'Active' : 'Inactive'}`);

    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json({ success: true, is_active: newStatus, message: `Design status changed to ${newStatus ? 'Active' : 'Inactive'}` });
    }

    req.flash('success', `Design #${id} is now ${newStatus ? 'Active' : 'Inactive'}.`);
    res.redirect('/admin/designs');
  } catch (err) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(500).json({ success: false, message: err.message });
    }
    next(err);
  }
};

exports.deleteImage = async (req, res, next) => {
  try {
    const { imageId } = req.params;
    await Design.deleteImage(imageId);
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json({ success: true, message: 'Image deleted successfully' });
    }
    req.flash('success', 'Image deleted.');
    res.redirect('back');
  } catch (err) {
    console.error('Delete image error:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(500).json({ success: false, message: err.message });
    }
    next(err);
  }
};

exports.setPrimaryImage = async (req, res, next) => {
  try {
    const { imageId } = req.params;
    await Design.setPrimaryImage(imageId);
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json({ success: true, message: 'Primary image updated' });
    }
    req.flash('success', 'Primary image updated.');
    res.redirect('back');
  } catch (err) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(500).json({ success: false, message: err.message });
    }
    next(err);
  }
};

exports.deleteFile = async (req, res, next) => {
  try {
    const { fileId } = req.params;
    await Design.deleteFile(fileId);
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json({ success: true, message: 'File deleted successfully' });
    }
    req.flash('success', 'Design file removed.');
    res.redirect('back');
  } catch (err) {
    console.error('Delete file error:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(500).json({ success: false, message: err.message });
    }
    next(err);
  }
};

exports.deleteAllFiles = async (req, res, next) => {
  try {
    const { designId } = req.params;
    await Design.deleteAllMachineFiles(designId);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'All machine files removed successfully.' });
    }

    req.flash('success', 'All uploaded machine files removed.');
    res.redirect('back');
  } catch (err) {
    console.error('Delete all files error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Error removing machine files.' });
    }
    next(err);
  }
};

exports.deleteDesign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    await Design.delete(id);
    await ActivityLog.logFromReq(req, 'delete', 'design', id, `Deleted design #${id}`);

    if (isAjax) {
      return res.json({
        success: true,
        message: 'Design deleted successfully.'
      });
    }

    req.flash('success', 'Design deleted successfully.');
    res.redirect('/admin/designs');
  } catch (err) {
    console.error('Design delete error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({
        success: false,
        message: err.message || 'Unable to delete design.'
      });
    }
    req.flash('error', `Unable to delete design: ${err.message}`);
    res.redirect('/admin/designs');
  }
};

exports.deleteAllDesigns = async (req, res, next) => {
  const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
  try {
    const { confirmationText, password } = req.body;

    // Safety checks: Type "DELETE ALL" and enter admin password
    if ((confirmationText || '').trim() !== 'DELETE ALL') {
      const msg = 'Confirmation text mismatch. You must type "DELETE ALL" exactly to proceed.';
      if (isAjax) return res.status(400).json({ success: false, message: msg });
      req.flash('error', msg);
      return res.redirect('/admin/designs');
    }

    if (!password || !String(password).trim()) {
      const msg = 'Admin password is required to perform Delete All Designs.';
      if (isAjax) return res.status(400).json({ success: false, message: msg });
      req.flash('error', msg);
      return res.redirect('/admin/designs');
    }

    // Verify admin password
    const adminId = req.user ? req.user.id : (req.session ? req.session.userId : null);
    let userRow = null;
    if (adminId) {
      const rows = await db.query('SELECT id, password_hash, role, is_active FROM users WHERE id = ?', [adminId]);
      userRow = rows && rows[0];
    }
    if (!userRow) {
      const rows = await db.query("SELECT id, password_hash, role, is_active FROM users WHERE email = 'admin@aruviembroidery.com' LIMIT 1");
      userRow = rows && rows[0];
    }

    if (!userRow) {
      const msg = 'Admin account verification failed. Action aborted.';
      if (isAjax) return res.status(403).json({ success: false, message: msg });
      req.flash('error', msg);
      return res.redirect('/admin/designs');
    }

    const isPasswordValid = await User.verifyPassword(password.trim(), userRow.password_hash);
    if (!isPasswordValid) {
      const msg = 'Incorrect admin password. Action aborted.';
      if (isAjax) return res.status(401).json({ success: false, message: msg });
      req.flash('error', msg);
      return res.redirect('/admin/designs');
    }

    // 1. Create automatic database backup archive beforehand
    let backupFilename = null;
    try {
      const backupResult = await runBackup();
      backupFilename = backupResult ? backupResult.filename : null;
      console.log('✅ Automated pre-deletion backup created:', backupFilename);
    } catch (backupErr) {
      console.warn('⚠️ Automated backup before delete-all encountered a warning:', backupErr.message);
    }

    // 2. Soft delete: recoverable for 30 days
    await db.query('UPDATE designs SET is_active = -1, deleted_at = NOW() WHERE is_active >= 0');

    await ActivityLog.logFromReq(
      req,
      'delete_all_soft',
      'design',
      null,
      `Soft-deleted all active designs (recoverable for 30 days). Pre-deletion backup archive: ${backupFilename || 'Created'}`
    );

    const successMsg = `All designs have been safely moved to trash (recoverable for 30 days). Pre-deletion backup archive created: ${backupFilename || 'Stored in backups'}.`;

    if (isAjax) {
      return res.json({ success: true, message: successMsg, backupFilename });
    }

    req.flash('success', successMsg);
    res.redirect('/admin/designs');
  } catch (err) {
    console.error('deleteAllDesigns error:', err);
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete all designs.' });
    }
    next(err);
  }
};

/**
 * Get live target count for Step 1
 * POST /admin/api/bulk-price/count
 */
exports.getBulkPriceCount = async (req, res, next) => {
  try {
    const { filters, selectedIds } = req.body;
    const count = await bulkPriceService.getLiveCount(filters || {}, selectedIds || []);
    res.json({ success: true, count });
  } catch (err) {
    console.error('getBulkPriceCount error:', err);
    res.status(500).json({ success: false, message: err.message || 'Unable to count target designs.' });
  }
};

/**
 * Build preview for Step 3
 * POST /admin/api/bulk-price/preview
 */
exports.getBulkPricePreview = async (req, res, next) => {
  try {
    let options = req.body || {};
    if (typeof options.filters === 'string') {
      try { options.filters = JSON.parse(options.filters); } catch (e) {}
    }
    const mergedOptions = {
      ...(options.filters || {}),
      ...options
    };

    if (req.file) {
      mergedOptions.method = 'file';
    }

    const preview = await bulkPriceService.buildPreview(mergedOptions, req.file || null);
    res.json({ success: true, ...preview });
  } catch (err) {
    console.error('getBulkPricePreview error:', err);
    res.status(500).json({ success: false, message: err.message || 'Unable to generate price preview.' });
  }
};

/**
 * Commit bulk price update in safe transaction
 * POST /admin/api/bulk-price/apply
 */
exports.applyBulkPriceUpdate = async (req, res, next) => {
  try {
    const { items, excludedIds, filterSummary, methodSummary } = req.body;
    const result = await bulkPriceService.applyPriceUpdate({
      items,
      excludedIds: excludedIds || [],
      filterSummary: filterSummary || 'Bulk Price Update',
      methodSummary: methodSummary || 'Custom Price Rule',
      adminUser: req.user
    });

    res.json({
      success: true,
      ...result,
      message: `Price update applied successfully to ${result.totalAffected} design(s)!`
    });
  } catch (err) {
    console.error('applyBulkPriceUpdate error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to apply price update.' });
  }
};

/**
 * Inline price editing in designs table
 * POST /admin/api/designs/:id/inline-price
 */
exports.updateInlinePrice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { sale_price, mrp, price } = req.body;

    const targetPrice = sale_price !== undefined ? Number(sale_price) : Number(price);
    if (isNaN(targetPrice) || targetPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Price must be a valid number greater than 0.' });
    }

    const existingRows = await db.query('SELECT id, sku, title, price, sale_price FROM designs WHERE id = ?', [id]);
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Design not found.' });
    }

    const d = existingRows[0];
    let newMrp = mrp !== undefined ? Number(mrp) : Number(d.price);
    let newSelling = targetPrice;

    // Selling price must not exceed MRP (auto-sync MRP if selling price is higher)
    if (newSelling > newMrp) {
      newMrp = newSelling;
    }

    newSelling = Math.round(newSelling * 100) / 100;
    newMrp = Math.round(newMrp * 100) / 100;

    await db.query(
      'UPDATE designs SET price = ?, sale_price = ?, updated_at = NOW() WHERE id = ?',
      [newMrp, newSelling, id]
    );

    const discountPercent = (newMrp > newSelling && newMrp > 0)
      ? Math.round(((newMrp - newSelling) / newMrp) * 100)
      : 0;

    await ActivityLog.logFromReq(req, 'inline_price_edit', 'design', id, `Updated price of ${d.sku || d.title} to ₹${newSelling} (MRP: ₹${newMrp})`);

    res.json({
      success: true,
      design_id: id,
      new_price: newSelling,
      new_mrp: newMrp,
      discount_percent: discountPercent,
      message: `Price for "${d.title}" updated to ₹${newSelling}.`
    });
  } catch (err) {
    console.error('updateInlinePrice error:', err);
    res.status(500).json({ success: false, message: err.message || 'Unable to update price.' });
  }
};

exports.deleteBulkDesigns = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No designs selected for deletion.' });
    }

    await Design.deleteBulk(ids);
    await ActivityLog.logFromReq(req, 'delete_bulk', 'design', null, `Bulk deleted ${ids.length} design(s)`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, message: `${ids.length} selected design(s) deleted successfully.` });
    }

    req.flash('success', `${ids.length} selected design(s) deleted successfully.`);
    res.redirect('/admin/designs');
  } catch (err) {
    console.error('deleteBulkDesigns error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete selected designs.' });
    }
    next(err);
  }
};

exports.duplicateDesign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const original = await Design.getById(id);
    if (!original) {
      const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
      if (isAjax) return res.status(404).json({ success: false, message: 'Design not found.' });
      req.flash('error', 'Design not found.');
      return res.redirect('/admin/designs');
    }

    const newTitle = `${original.title} (Copy)`;
    const newSlug = await Design.generateUniqueSlug(newTitle);

    let newSku = null;
    try {
      if (original.category_id) {
        newSku = await Design.getNextSkuForCategory(original.category_id);
      }
    } catch (e) {
      newSku = `AED-CPY-${Date.now().toString().slice(-4)}`;
    }

    const newDesignId = await Design.create({
      title: newTitle,
      slug: newSlug,
      sku: newSku,
      description: original.description || '',
      price: original.price || 0,
      sale_price: original.sale_price !== null && original.sale_price !== undefined ? original.sale_price : null,
      category_id: original.category_id,
      hoop_size: original.hoop_size || null,
      stitch_count: original.stitch_count || null,
      dimensions: original.dimensions || null,
      formats: original.formats || 'DST',
      tags: original.tags || null,
      is_featured: 0,
      is_active: 0 // Inactive draft upon duplication
    });

    // Copy design images
    if (original.images && original.images.length > 0) {
      for (const img of original.images) {
        await Design.addImage(newDesignId, img.image_url, img.is_primary, img.display_order);
      }
    }

    // Copy design files
    if (original.files && original.files.length > 0) {
      for (const f of original.files) {
        await Design.addFile(newDesignId, f.file_name, f.file_path, f.file_format, f.file_size, f.is_preview);
      }
    }

    await ActivityLog.logFromReq(req, 'duplicate', 'design', newDesignId, `Duplicated design #${id} "${original.title}" into #${newDesignId} "${newTitle}"`);

    const isAjax = checkIsAjax(req);
    if (isAjax) {
      return res.json({
        success: true,
        message: `Design duplicated successfully as "${newTitle}" with SKU ${newSku}.`,
        newDesignId
      });
    }

    if (typeof req.flash === 'function') {
      req.flash('success', `Design duplicated successfully as "${newTitle}" (SKU: ${newSku}).`);
    }
    if (typeof res.redirect === 'function') res.redirect('/admin/designs');
  } catch (err) {
    console.error('duplicateDesign error:', err);
    const isAjax = checkIsAjax(req);
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to duplicate design.' });
    }
    if (typeof req.flash === 'function') {
      req.flash('error', `Unable to duplicate design: ${err.message}`);
    }
    if (typeof res.redirect === 'function') res.redirect('/admin/designs');
  }
};

const bulkImportService = require('../../services/bulkImportService');

/**
 * Bulk Import Step 1: Download Spreadsheet Template
 */
exports.downloadImportTemplate = async (req, res, next) => {
  try {
    const buffer = bulkImportService.generateTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Aruvi_Design_Import_Template.xlsx"');
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk Import Step 1: Parse & Validate Spreadsheet Only (Fast, safe, preview table)
 */
exports.postImportPreview = async (req, res, next) => {
  try {
    let file = req.file;
    if (!file && req.files) {
      file = Array.isArray(req.files) ? req.files[0] : Object.values(req.files).flat()[0];
    }
    if (!file) {
      return res.status(400).json({ success: false, message: 'Please upload a spreadsheet data file (.xlsx, .xls, .csv).' });
    }

    const userId = req.user ? req.user.id : null;
    const result = await bulkImportService.parseSpreadsheetFile(file.path, file.originalname, userId);
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    const isDbOrInternal = !!(err.sql || err.code || err.sqlState || err.name === 'TypeError' || err.name === 'SyntaxError');
    const refId = errorLogger.logSqlError({
      context: 'Bulk Import: Parse Spreadsheet',
      error: err,
      query: err.sql,
      params: err.params
    });

    console.error(`[Bulk Import Preview Error] [Reference ID: ${refId}]:`, err.message);

    const friendlyMessage = `Import failed. Reference ID: ${refId}`;
    const isProd = process.env.NODE_ENV === 'production';

    return res.status(400).json({
      success: false,
      message: (isProd || isDbOrInternal) ? friendlyMessage : (err.message || friendlyMessage),
      referenceId: refId
    });
  }
};

/**
 * Bulk Import Step 2: Upload Assets in Small Batches (5-10 files) with SKU Auto-Matching
 */
exports.postImportUploadAssets = async (req, res, next) => {
  try {
    const { batchId } = req.body;
    if (!batchId) {
      return res.status(400).json({ success: false, message: 'Missing import session batchId.' });
    }

    const files = req.files || (req.file ? [req.file] : []);
    const fileList = Array.isArray(files) ? files : Object.values(files).flat();
    if (fileList.length === 0) {
      return res.status(400).json({ success: false, message: 'No asset files received in this batch.' });
    }

    const result = await bulkImportService.processAssetBatch(batchId, fileList);
    return res.json({ success: true, ...result });
  } catch (err) {
    const isDbOrInternal = !!(err.sql || err.code || err.sqlState);
    const refId = errorLogger.logSqlError({
      context: 'Bulk Import: Asset Batch Upload',
      error: err,
      query: err.sql,
      params: err.params
    });

    console.error(`[Bulk Import Asset Error] [Reference ID: ${refId}]:`, err.message);

    const friendlyMessage = `Asset upload failed. Reference ID: ${refId}`;
    const isProd = process.env.NODE_ENV === 'production';

    return res.status(500).json({
      success: false,
      message: (isProd || isDbOrInternal) ? friendlyMessage : (err.message || friendlyMessage),
      referenceId: refId
    });
  }
};

/**
 * Bulk Import Step 3: Trigger Background Import Job
 */
exports.postImportStartJob = async (req, res, next) => {
  try {
    const { batchId, updateExisting, skipErrors, categoryMappings } = req.body;
    if (!batchId) {
      return res.status(400).json({ success: false, message: 'Missing import session batchId.' });
    }

    const result = await bulkImportService.startImportJob(batchId, {
      updateExisting: updateExisting === true || updateExisting === 'true' || updateExisting === 1 || updateExisting === '1',
      skipErrors: skipErrors !== false && skipErrors !== 'false' && skipErrors !== 0 && skipErrors !== '0',
      categoryMappings: categoryMappings || {}
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const isDbOrInternal = !!(err.sql || err.code || err.sqlState);
    const refId = errorLogger.logSqlError({
      context: 'Bulk Import: Start Job',
      error: err,
      query: err.sql,
      params: err.params
    });

    console.error(`[Bulk Import Job Error] [Reference ID: ${refId}]:`, err.message);

    const friendlyMessage = `Import job failed to start. Reference ID: ${refId}`;
    const isProd = process.env.NODE_ENV === 'production';

    return res.status(500).json({
      success: false,
      message: (isProd || isDbOrInternal) ? friendlyMessage : (err.message || friendlyMessage),
      referenceId: refId
    });
  }
};

// Backwards compatibility alias
exports.postImportCommit = exports.postImportStartJob;

/**
 * Bulk Import Step 3: Poll Live Status & Progress
 */
exports.getImportJobStatus = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const status = await bulkImportService.getJobStatus(batchId);
    if (!status) {
      return res.status(404).json({ success: false, message: 'Import job session not found.' });
    }
    return res.json({ success: true, ...status });
  } catch (err) {
    const refId = errorLogger.logSqlError({
      context: 'Bulk Import: Get Status',
      error: err,
      query: err.sql,
      params: err.params
    });
    console.error(`[Bulk Import Status Error] [Reference ID: ${refId}]:`, err.message);
    return res.status(500).json({
      success: false,
      message: `Failed to retrieve import status. Reference ID: ${refId}`,
      referenceId: refId
    });
  }
};

/**
 * Bulk Import Safety: Rollback designs created in this import job
 */
exports.postImportRollback = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const result = await bulkImportService.rollbackImportJob(batchId);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('postImportRollback error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Bulk Import: Download CSV Error Report
 */
exports.downloadImportErrorReport = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const csvContent = await bulkImportService.generateErrorReportCsv(batchId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import_errors_${batchId}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    next(err);
  }
};

exports.replaceImage = async (req, res) => {
  try {
    const { id } = req.params;
    const design = await Design.getById(id);
    if (!design) {
      return res.status(404).json({ success: false, message: 'Design not found' });
    }

    const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [];
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select an image file to upload.' });
    }

    const file = files[0];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.svg', '.avif'].includes(ext)) {
      return res.status(400).json({ success: false, message: 'Invalid image format. Supported formats: JPG, PNG, WEBP, SVG, AVIF' });
    }

    const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
    await Design.replacePrimaryImage(id, savedUrl, file.originalname, file.size);
    await ActivityLog.logFromReq(req, 'update_image', 'design', id, `Replaced primary image for design #${id} "${design.title}"`);

    const isAjax = checkIsAjax(req);
    if (isAjax) {
      return res.json({
        success: true,
        message: `Image for "${design.title}" updated successfully!`,
        imageUrl: savedUrl,
        designId: id
      });
    }

    req.flash('success', `Image for "${design.title}" updated successfully!`);
    return res.redirect('back');
  } catch (err) {
    console.error('replaceImage error:', err);
    const isAjax = checkIsAjax(req);
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message });
    }
    req.flash('error', `Failed to replace image: ${err.message}`);
    return res.redirect('back');
  }
};

/**
 * Helper to calculate string similarity for closest suggestions
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = String(str1).toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = String(str2).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  if (s1.includes(s2) || s2.includes(s1)) {
    return Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
  }

  // Bigram Dice coefficient
  const getBigrams = str => {
    const set = new Set();
    for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
    return set;
  };
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  b1.forEach(b => { if (b2.has(b)) intersection++; });
  return parseFloat(((2 * intersection) / (b1.size + b2.size || 1)).toFixed(2));
}

/**
 * Robust Multi-Tier Image Matching Engine
 * Priority Order (First Match Wins):
 *   a) Exact SKU, case-insensitive (AED-BLO-01.png, AED 1.PNG)
 *   b) Product ID (1.png)
 *   c) Exact Title after normalization (lowercase, trimmed, extension removed case-insensitively, spaces/hyphens/underscores collapsed)
 *   d) Preview Image Filename column stored from bulk import (designs.import_image_filename)
 *   e) Slug
 *   f) Fallback AED numeric prefix (e.g. AED 1 -> ID 1)
 *
 * Excludes only permanently deleted designs (matches active, draft, inactive).
 * Flags ambiguous files if multiple designs match.
 */
async function findMatchingDesign(filename, allDesignsCache = null) {
  if (!filename || !db.isConnected()) {
    return { status: 'unmatched', reason: 'Database is offline or filename is empty', suggestions: [] };
  }

  // 1. Case-insensitive extension extraction
  const rawExt = path.extname(filename || '');
  const ext = rawExt.toLowerCase();
  const rawBaseName = (rawExt ? filename.slice(0, -rawExt.length) : filename).trim();

  if (!rawBaseName) {
    return { status: 'unmatched', reason: 'Invalid or empty filename', suggestions: [] };
  }

  const cleanLower = rawBaseName.toLowerCase();
  const cleanAlphaNum = rawBaseName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const cleanCollapsed = rawBaseName.replace(/[\s\-_]+/g, ' ').trim().toLowerCase();
  const numericId = /^\d+$/.test(rawBaseName) ? parseInt(rawBaseName, 10) : null;
  const aedMatch = rawBaseName.match(/^AED[\s\-_]*0*(\d+)$/i);
  const aedNumericId = aedMatch ? parseInt(aedMatch[1], 10) : null;

  console.log(`[Bulk Image Matcher] Checking "${filename}": Base="${rawBaseName}", AlphaNum="${cleanAlphaNum}", NumericID=${numericId}`);

  // Helper to query and evaluate single vs ambiguous match
  async function checkCandidates(querySql, params, matchedBy) {
    const rows = await db.query(querySql, params);
    if (!rows || rows.length === 0) return null;
    if (rows.length === 1) {
      return { status: 'matched', design: rows[0], matchedBy };
    }
    return { status: 'ambiguous', candidates: rows, matchedBy };
  }

  // --------------------------------------------------------------------------
  // a) Exact SKU, case-insensitive (AED-BLO-01.png, AED 1.PNG)
  // --------------------------------------------------------------------------
  const matchSku = await checkCandidates(
    `SELECT id, title, sku, slug, import_image_filename, is_active 
     FROM designs 
     WHERE LOWER(sku) = ? 
        OR REPLACE(REPLACE(REPLACE(LOWER(sku), ' ', ''), '_', ''), '-', '') = ?`,
    [cleanLower, cleanAlphaNum],
    'sku'
  );
  if (matchSku) {
    console.log(`[Bulk Image Matcher] Matched by SKU (${matchSku.matchedBy}): "${filename}" -> ID=${matchSku.design?.id || 'Ambiguous'}`);
    return matchSku;
  }

  // --------------------------------------------------------------------------
  // b) Product ID (1.png, 042.png)
  // --------------------------------------------------------------------------
  if (numericId !== null && numericId > 0) {
    const matchId = await checkCandidates(
      `SELECT id, title, sku, slug, import_image_filename, is_active 
       FROM designs 
       WHERE id = ?`,
      [numericId],
      'id'
    );
    if (matchId) {
      console.log(`[Bulk Image Matcher] Matched by Product ID: "${filename}" -> ID=${matchId.design?.id || 'Ambiguous'}`);
      return matchId;
    }
  }

  // --------------------------------------------------------------------------
  // c) Exact Title after normalization (lowercase, trimmed, spaces/hyphens/underscores collapsed)
  // "AED 1.PNG" = title "AED 1"
  // --------------------------------------------------------------------------
  const matchTitle = await checkCandidates(
    `SELECT id, title, sku, slug, import_image_filename, is_active 
     FROM designs 
     WHERE LOWER(TRIM(title)) = ? 
        OR REPLACE(REPLACE(REPLACE(LOWER(title), ' ', ''), '_', ''), '-', '') = ?`,
    [cleanLower, cleanAlphaNum],
    'title'
  );
  if (matchTitle) {
    console.log(`[Bulk Image Matcher] Matched by Title: "${filename}" -> ID=${matchTitle.design?.id || 'Ambiguous'}`);
    return matchTitle;
  }

  // --------------------------------------------------------------------------
  // d) Preview Image Filename column stored from bulk import (designs.import_image_filename)
  // --------------------------------------------------------------------------
  const matchImportFilename = await checkCandidates(
    `SELECT id, title, sku, slug, import_image_filename, is_active 
     FROM designs 
     WHERE import_image_filename IS NOT NULL 
       AND (
         LOWER(import_image_filename) = ?
         OR LOWER(import_image_filename) = ?
         OR REPLACE(REPLACE(REPLACE(LOWER(import_image_filename), ' ', ''), '_', ''), '-', '') = ?
       )`,
    [filename.toLowerCase(), cleanLower, cleanAlphaNum],
    'import_image_filename'
  );
  if (matchImportFilename) {
    console.log(`[Bulk Image Matcher] Matched by import_image_filename: "${filename}" -> ID=${matchImportFilename.design?.id || 'Ambiguous'}`);
    return matchImportFilename;
  }

  // --------------------------------------------------------------------------
  // e) Slug
  // --------------------------------------------------------------------------
  const matchSlug = await checkCandidates(
    `SELECT id, title, sku, slug, import_image_filename, is_active 
     FROM designs 
     WHERE LOWER(slug) = ? 
        OR REPLACE(REPLACE(REPLACE(LOWER(slug), ' ', ''), '_', ''), '-', '') = ?`,
    [cleanLower, cleanAlphaNum],
    'slug'
  );
  if (matchSlug) {
    console.log(`[Bulk Image Matcher] Matched by Slug: "${filename}" -> ID=${matchSlug.design?.id || 'Ambiguous'}`);
    return matchSlug;
  }

  // --------------------------------------------------------------------------
  // Fallback: AED Number prefix (e.g. "AED 1.png" -> ID 1)
  // --------------------------------------------------------------------------
  if (aedNumericId !== null && aedNumericId > 0) {
    const matchAedId = await checkCandidates(
      `SELECT id, title, sku, slug, import_image_filename, is_active 
       FROM designs 
       WHERE id = ?`,
      [aedNumericId],
      'aed_id_fallback'
    );
    if (matchAedId) {
      console.log(`[Bulk Image Matcher] Matched by AED ID fallback: "${filename}" -> ID=${matchAedId.design?.id || 'Ambiguous'}`);
      return matchAedId;
    }
  }

  // --------------------------------------------------------------------------
  // Unmatched: Compute Top 3 Closest Suggestions
  // --------------------------------------------------------------------------
  let suggestions = [];
  try {
    let designsList = allDesignsCache;
    if (!designsList) {
      designsList = await db.query('SELECT id, title, sku FROM designs LIMIT 500');
    }

    if (designsList && designsList.length > 0) {
      const scored = designsList.map(d => {
        const skuSim = calculateSimilarity(cleanAlphaNum, d.sku);
        const titleSim = calculateSimilarity(cleanAlphaNum, d.title);
        const maxSim = Math.max(skuSim, titleSim);
        return {
          id: d.id,
          sku: d.sku,
          title: d.title,
          similarity: parseFloat(maxSim.toFixed(2))
        };
      });

      scored.sort((a, b) => b.similarity - a.similarity);
      suggestions = scored.slice(0, 3).filter(s => s.similarity > 0.1);
    }
  } catch (sugErr) {
    console.warn('[Suggestions warning]:', sugErr.message);
  }

  console.log(`[Bulk Image Matcher] UNMATCHED: "${filename}". Top suggestions: ${JSON.stringify(suggestions)}`);

  return {
    status: 'unmatched',
    reason: 'No matching product found by SKU, Product ID, Title, Import Image Filename, or Slug.',
    suggestions
  };
}

/**
 * Temporary directory cleanup: Removes temp files older than 24 hours.
 */
function cleanupTempUnmatchedFiles() {
  try {
    const tempDir = path.join(storage.getUploadsDir(), 'temp_unmatched');
    if (!fs.existsSync(tempDir)) return;
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    const files = fs.readdirSync(tempDir);
    for (const f of files) {
      const p = path.join(tempDir, f);
      const stat = fs.statSync(p);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(p);
      }
    }
  } catch (e) {
    // Non-blocking cleanup
  }
}

/**
 * Endpoint to check if database has designs before starting bulk upload
 */
exports.bulkUploadCheck = async (req, res) => {
  try {
    if (!db.isConnected()) await db.initPool();
    const rows = await db.query('SELECT COUNT(*) as count FROM designs');
    const totalCount = rows && rows[0] ? rows[0].count : 0;

    const designs = await db.query('SELECT id, sku, title FROM designs ORDER BY id ASC LIMIT 2000');

    return res.json({
      success: true,
      count: totalCount,
      isEmpty: totalCount === 0,
      designs: designs || []
    });
  } catch (err) {
    console.error('[Bulk Upload Check Error]:', err);
    return res.status(500).json({ success: false, message: err.message, isEmpty: false, count: 0, designs: [] });
  }
};

/**
 * Endpoint to manually link an unmatched or ambiguous image to a specific design
 */
exports.linkSingleImage = async (req, res) => {
  try {
    const { designId, tempToken, originalName } = req.body;
    if (!designId || !tempToken) {
      return res.status(400).json({ success: false, message: 'Design ID and file token are required.' });
    }

    const design = await Design.getById(designId);
    if (!design) {
      return res.status(404).json({ success: false, message: `Design #${designId} not found.` });
    }

    const tempDir = path.join(storage.getUploadsDir(), 'temp_unmatched');
    const safeToken = path.basename(tempToken);
    const tempPath = path.join(tempDir, safeToken);

    if (!fs.existsSync(tempPath)) {
      return res.status(404).json({ success: false, message: 'Temporary file expired or not found. Please re-upload.' });
    }

    const finalName = originalName || safeToken;
    const ext = path.extname(finalName).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');

    // Save to persistent storage and generate 300px WebP thumbnail
    const savedUrl = await storage.savePublicFile(tempPath, finalName, mimeType);

    // Idempotently set as primary image
    const stats = fs.statSync(tempPath);
    await Design.replacePrimaryImage(design.id, savedUrl, finalName, stats.size);

    // Delete temp file
    try { fs.unlinkSync(tempPath); } catch (e) {}

    await ActivityLog.logFromReq(req, 'link_bulk_image_manual', 'design', design.id, `Manually linked image "${finalName}" to design #${design.id} (${design.title})`);

    return res.json({
      success: true,
      message: `Successfully linked "${finalName}" to design #${design.id} (${design.sku || design.title})!`,
      designId: design.id,
      sku: design.sku,
      title: design.title,
      imageUrl: savedUrl
    });
  } catch (err) {
    console.error('[Manual Image Link Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.bulkUploadImages = async (req, res) => {
  try {
    const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images were uploaded in this batch.',
        matched: [],
        unmatched: [],
        ambiguous: [],
        failed: []
      });
    }

    // Run temp file cleanup
    cleanupTempUnmatchedFiles();

    // Cache design list for suggestions in this batch
    let allDesignsCache = null;
    try {
      allDesignsCache = await db.query('SELECT id, title, sku FROM designs LIMIT 500');
    } catch (cErr) {}

    const tempUnmatchedDir = path.join(storage.getUploadsDir(), 'temp_unmatched');
    if (!fs.existsSync(tempUnmatchedDir)) {
      fs.mkdirSync(tempUnmatchedDir, { recursive: true });
    }

    const matched = [];
    const unmatched = [];
    const ambiguous = [];
    const failed = [];

    for (const file of files) {
      const originalName = file.originalname;
      try {
        const rawExt = path.extname(originalName || '');
        const ext = rawExt.toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext)) {
          if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
          }
          unmatched.push({
            filename: originalName,
            reason: `Unsupported image format (${rawExt || 'none'}). Only JPG, PNG, WEBP, and AVIF are allowed.`,
            suggestions: []
          });
          continue;
        }

        const matchResult = await findMatchingDesign(originalName, allDesignsCache);

        if (matchResult.status === 'matched') {
          const matchedDesign = matchResult.design;

          // Save to persistent storage (generates 300px WebP thumbnail inside savePublicFile)
          const savedUrl = await storage.savePublicFile(file.path, originalName, file.mimetype);

          // Idempotently update DB: set as primary image in design_images and design_files
          await Design.replacePrimaryImage(matchedDesign.id, savedUrl, originalName, file.size);

          // Clean up multer temporary disk file
          if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
          }

          matched.push({
            filename: originalName,
            designId: matchedDesign.id,
            title: matchedDesign.title,
            sku: matchedDesign.sku,
            imageUrl: savedUrl,
            matchedBy: matchResult.matchedBy
          });

        } else if (matchResult.status === 'ambiguous') {
          // File matches multiple designs: move to temp_unmatched folder and list candidates
          const randomHex = crypto.randomBytes(6).toString('hex');
          const tempFilename = `ambiguous-${Date.now()}-${randomHex}${ext}`;
          const destTempPath = path.join(tempUnmatchedDir, tempFilename);

          if (file.path && fs.existsSync(file.path)) {
            try { fs.renameSync(file.path, destTempPath); } catch (e) { fs.copyFileSync(file.path, destTempPath); fs.unlinkSync(file.path); }
          }

          ambiguous.push({
            filename: originalName,
            tempToken: tempFilename,
            reason: `Ambiguous match: multiple products share SKU or Title (${matchResult.candidates.length} candidates).`,
            candidates: matchResult.candidates.map(c => ({ id: c.id, sku: c.sku, title: c.title })),
            matchedBy: matchResult.matchedBy
          });

        } else {
          // Unmatched: move to temp_unmatched folder for 24h manual linking (avoid permanent storage clutter)
          const randomHex = crypto.randomBytes(6).toString('hex');
          const tempFilename = `unmatched-${Date.now()}-${randomHex}${ext}`;
          const destTempPath = path.join(tempUnmatchedDir, tempFilename);

          if (file.path && fs.existsSync(file.path)) {
            try { fs.renameSync(file.path, destTempPath); } catch (e) { fs.copyFileSync(file.path, destTempPath); fs.unlinkSync(file.path); }
          }

          unmatched.push({
            filename: originalName,
            tempToken: tempFilename,
            reason: matchResult.reason || 'No matching product found.',
            suggestions: matchResult.suggestions || []
          });
        }
      } catch (fileErr) {
        // Clean up temp file
        if (file.path && fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (e) {}
        }

        const refId = errorLogger.logSqlError({
          context: 'Bulk Image Upload',
          error: fileErr,
          referenceId: errorLogger.generateReferenceId()
        });

        console.error(`[Bulk Image Error] [${refId}] File "${originalName}":`, fileErr.message);

        failed.push({
          filename: originalName,
          error: fileErr.message,
          referenceId: refId
        });
      }
    }

    if (matched.length > 0) {
      await ActivityLog.logFromReq(
        req,
        'bulk_upload_images_batch',
        'design',
        null,
        `Bulk image batch processed: ${matched.length} linked, ${unmatched.length} unmatched, ${ambiguous.length} ambiguous, ${failed.length} failed`
      );
    }

    return res.json({
      success: true,
      message: `Batch processed: ${matched.length} linked, ${unmatched.length} unmatched, ${ambiguous.length} ambiguous, ${failed.length} failed.`,
      matched,
      unmatched,
      ambiguous,
      failed,
      processedCount: files.length
    });
  } catch (err) {
    const refId = errorLogger.logSqlError({
      context: 'Bulk Image Upload Batch',
      error: err,
      referenceId: errorLogger.generateReferenceId()
    });
    console.error(`[Bulk Image Batch Fatal Error] [${refId}]:`, err);
    return res.status(500).json({
      success: false,
      message: `Batch upload failed: ${err.message}`,
      referenceId: refId,
      matched: [],
      unmatched: [],
      ambiguous: [],
      failed: [{ filename: 'batch', error: err.message, referenceId: refId }]
    });
  }
};

/**
 * ============================================================================
 * BULK MACHINE FILES (ZIP) UPLOAD & MATCHING ENGINE
 * ============================================================================
 */

/**
 * Validates a machine file or archive:
 * - Direct machine formats: .dst, .pes, .jef, .exp (accepted)
 * - Archives: .zip, .rar
 * - Strict ZIP validation:
 *    - Must open without errors
 *    - No Zip Slip paths (entry starts with / or \ or contains ..)
 *    - No dangerous executables (.exe, .js, .php, .sh, .bat, .cmd, .vbs, .py, .bin, .msi, .dll)
 *    - Must contain at least one machine file (.dst, .pes, .jef, .exp)
 *    - Auto-detects distinct machine formats
 */
function validateMachineFileOrZip(filePath, originalName) {
  const rawExt = path.extname(originalName || '');
  const ext = rawExt.toLowerCase();
  const directMachineFormats = ['.dst', '.pes', '.jef', '.exp'];

  if (directMachineFormats.includes(ext)) {
    return {
      isValid: true,
      detectedFormats: [ext.slice(1).toUpperCase()],
      isArchive: false
    };
  }

  if (ext === '.rar') {
    return {
      isValid: true,
      detectedFormats: ['DST', 'PES', 'JEF', 'EXP'],
      isArchive: true
    };
  }

  if (ext === '.zip') {
    let zip;
    try {
      zip = new AdmZip(filePath);
    } catch (err) {
      return {
        isValid: false,
        reason: `Corrupt ZIP file: ${err.message}`
      };
    }

    const dangerousExts = ['.exe', '.js', '.php', '.sh', '.bat', '.cmd', '.vbs', '.py', '.msi', '.dll', '.com', '.bin'];
    const machineExts = ['.dst', '.pes', '.jef', '.exp'];
    const detectedFormats = new Set();
    let hasMachineFile = false;

    let entries;
    try {
      entries = zip.getEntries();
    } catch (err) {
      return {
        isValid: false,
        reason: `Corrupted ZIP archive: ${err.message}`
      };
    }

    if (!entries || entries.length === 0) {
      return {
        isValid: false,
        reason: 'ZIP archive is empty.'
      };
    }

    for (const entry of entries) {
      const entryName = entry.entryName;

      // 1. Zip Slip check
      if (entryName.includes('..') || entryName.startsWith('/') || entryName.startsWith('\\') || /^[a-zA-Z]:/.test(entryName)) {
        return {
          isValid: false,
          reason: 'Security violation: Zip Slip path traversal detected in archive.'
        };
      }

      if (entry.isDirectory) continue;

      const fileExt = path.extname(entryName).toLowerCase();

      // 2. Executables check
      if (dangerousExts.includes(fileExt)) {
        return {
          isValid: false,
          reason: `Security violation: Prohibited executable or script "${fileExt}" detected inside ZIP.`
        };
      }

      // 3. Machine file format check
      if (machineExts.includes(fileExt)) {
        hasMachineFile = true;
        detectedFormats.add(fileExt.slice(1).toUpperCase());
      }
    }

    if (!hasMachineFile) {
      return {
        isValid: false,
        reason: 'Invalid ZIP: Archive does not contain any machine embroidery format files (.dst, .pes, .jef, .exp).'
      };
    }

    return {
      isValid: true,
      detectedFormats: Array.from(detectedFormats),
      isArchive: true
    };
  }

  return {
    isValid: false,
    reason: `Unsupported file extension (${rawExt || 'none'}). Allowed: .zip, .rar, .dst, .pes, .jef, .exp.`
  };
}

/**
 * Robust Multi-Tier Machine ZIP Matching Engine
 * Priority Order:
 *   a) Exact SKU, case-insensitive (AED-BLO-01.zip, AED 1.ZIP)
 *   b) Product ID (1.zip, 042.zip)
 *   c) Normalized Title ("AED 1.ZIP" = "AED 1")
 *   d) Machine ZIP Filename stored from bulk import (designs.import_zip_filename)
 *   e) Slug
 *   f) Fallback AED numeric ID (AED 1 -> ID 1)
 */
async function findMatchingDesignForZip(filename, allDesignsCache = null) {
  if (!filename || !db.isConnected()) {
    return { status: 'unmatched', reason: 'Database is offline or filename is empty', suggestions: [] };
  }

  const rawExt = path.extname(filename || '');
  const rawBaseName = (rawExt ? filename.slice(0, -rawExt.length) : filename).trim();

  if (!rawBaseName) {
    return { status: 'unmatched', reason: 'Invalid or empty filename', suggestions: [] };
  }

  const cleanLower = rawBaseName.toLowerCase();
  const cleanAlphaNum = rawBaseName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const numericId = /^\d+$/.test(rawBaseName) ? parseInt(rawBaseName, 10) : null;
  const aedMatch = rawBaseName.match(/^AED[\s\-_]*0*(\d+)$/i);
  const aedNumericId = aedMatch ? parseInt(aedMatch[1], 10) : null;

  async function checkCandidates(querySql, params, matchedBy) {
    const rows = await db.query(querySql, params);
    if (!rows || rows.length === 0) return null;
    if (rows.length === 1) {
      return { status: 'matched', design: rows[0], matchedBy };
    }
    return { status: 'ambiguous', candidates: rows, matchedBy };
  }

  // a) Exact SKU (case-insensitive)
  const matchSku = await checkCandidates(
    `SELECT id, title, sku, slug, import_zip_filename, is_active 
     FROM designs 
     WHERE is_active >= 0 AND (
       LOWER(sku) = ? 
       OR REPLACE(REPLACE(REPLACE(LOWER(sku), ' ', ''), '_', ''), '-', '') = ?
     )`,
    [cleanLower, cleanAlphaNum],
    'sku'
  );
  if (matchSku) return matchSku;

  // b) Product ID (1.zip, 042.zip)
  if (numericId !== null && numericId > 0) {
    const matchId = await checkCandidates(
      `SELECT id, title, sku, slug, import_zip_filename, is_active 
       FROM designs 
       WHERE is_active >= 0 AND id = ?`,
      [numericId],
      'id'
    );
    if (matchId) return matchId;
  }

  // c) Normalized Title ("AED 1.ZIP" = "AED 1")
  const matchTitle = await checkCandidates(
    `SELECT id, title, sku, slug, import_zip_filename, is_active 
     FROM designs 
     WHERE is_active >= 0 AND (
       LOWER(TRIM(title)) = ? 
       OR REPLACE(REPLACE(REPLACE(LOWER(title), ' ', ''), '_', ''), '-', '') = ?
     )`,
    [cleanLower, cleanAlphaNum],
    'title'
  );
  if (matchTitle) return matchTitle;

  // d) Machine ZIP Filename stored from bulk import (designs.import_zip_filename)
  const matchImportZip = await checkCandidates(
    `SELECT id, title, sku, slug, import_zip_filename, is_active 
     FROM designs 
     WHERE is_active >= 0 AND import_zip_filename IS NOT NULL AND (
       LOWER(import_zip_filename) = ? 
       OR LOWER(import_zip_filename) = ?
       OR REPLACE(REPLACE(REPLACE(LOWER(import_zip_filename), ' ', ''), '_', ''), '-', '') = ?
     )`,
    [filename.toLowerCase(), cleanLower, cleanAlphaNum],
    'import_zip_filename'
  );
  if (matchImportZip) return matchImportZip;

  // e) Slug
  const matchSlug = await checkCandidates(
    `SELECT id, title, sku, slug, import_zip_filename, is_active 
     FROM designs 
     WHERE is_active >= 0 AND (
       LOWER(slug) = ? 
       OR REPLACE(REPLACE(REPLACE(LOWER(slug), ' ', ''), '_', ''), '-', '') = ?
     )`,
    [cleanLower, cleanAlphaNum],
    'slug'
  );
  if (matchSlug) return matchSlug;

  // f) AED Number prefix fallback (e.g. "AED 1.zip" -> ID 1)
  if (aedNumericId !== null && aedNumericId > 0) {
    const matchAedId = await checkCandidates(
      `SELECT id, title, sku, slug, import_zip_filename, is_active 
       FROM designs 
       WHERE is_active >= 0 AND id = ?`,
      [aedNumericId],
      'aed_id_fallback'
    );
    if (matchAedId) return matchAedId;
  }

  // g) Unmatched: Top 3 suggestions
  let suggestions = [];
  try {
    let designsList = allDesignsCache;
    if (!designsList) {
      designsList = await db.query('SELECT id, title, sku FROM designs WHERE is_active >= 0 LIMIT 500');
    }
    if (designsList && designsList.length > 0) {
      const scored = designsList.map(d => {
        const skuSim = calculateSimilarity(cleanAlphaNum, d.sku);
        const titleSim = calculateSimilarity(cleanAlphaNum, d.title);
        const maxSim = Math.max(skuSim, titleSim);
        return {
          id: d.id,
          sku: d.sku,
          title: d.title,
          similarity: parseFloat(maxSim.toFixed(2))
        };
      });
      scored.sort((a, b) => b.similarity - a.similarity);
      suggestions = scored.slice(0, 3).filter(s => s.similarity > 0.1);
    }
  } catch (sugErr) {
    console.warn('[ZIP Suggestions warning]:', sugErr.message);
  }

  return {
    status: 'unmatched',
    reason: 'No matching product found by SKU, Product ID, Title, Import ZIP Filename, or Slug.',
    suggestions
  };
}

/**
 * Temporary directory cleanup for ZIP chunks & unmatched archives:
 * - Removes unmatched files older than 24 hours.
 * - Removes abandoned chunk sessions older than 2 hours.
 */
function cleanupTempUnmatchedZips() {
  try {
    const tempDir = path.join(storage.getUploadsDir(), 'temp_unmatched_zips');
    if (fs.existsSync(tempDir)) {
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      const files = fs.readdirSync(tempDir);
      for (const f of files) {
        const p = path.join(tempDir, f);
        const stat = fs.statSync(p);
        if (now - stat.mtimeMs > maxAge) {
          try { fs.unlinkSync(p); } catch (_) {}
        }
      }
    }

    const chunkDir = path.join(storage.getUploadsDir(), 'temp_chunks');
    if (fs.existsSync(chunkDir)) {
      const now = Date.now();
      const maxChunkAge = 2 * 60 * 60 * 1000; // 2 hours
      const chunkFolders = fs.readdirSync(chunkDir);
      for (const folder of chunkFolders) {
        const folderPath = path.join(chunkDir, folder);
        try {
          const stat = fs.statSync(folderPath);
          if (now - stat.mtimeMs > maxChunkAge) {
            fs.rmSync(folderPath, { recursive: true, force: true });
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    // Non-blocking cleanup
  }
}

/**
 * Pre-upload check: Ensures database has designs and returns max upload size setting
 */
exports.bulkZipCheck = async (req, res) => {
  try {
    if (!db.isConnected()) await db.initPool();
    const rows = await db.query('SELECT COUNT(*) as count FROM designs WHERE is_active >= 0');
    const totalCount = rows && rows[0] ? rows[0].count : 0;

    const maxMb = await Setting.get('max_upload_zip_size_mb', '100');
    const designs = await db.query('SELECT id, sku, title FROM designs WHERE is_active >= 0 ORDER BY id ASC LIMIT 2000');

    return res.json({
      success: true,
      count: totalCount,
      isEmpty: totalCount === 0,
      maxUploadSizeMb: parseInt(maxMb, 10) || 100,
      designs: designs || []
    });
  } catch (err) {
    console.error('[Bulk ZIP Check Error]:', err);
    return res.status(500).json({ success: false, message: err.message, isEmpty: false, count: 0, designs: [] });
  }
};

/**
 * Pre-upload Dry-Run Matcher:
 * Matches filenames before large file transfer starts.
 * Returns matched, unmatched, and ambiguous counts and previews.
 */
exports.bulkZipDryRun = async (req, res) => {
  try {
    const { filenames } = req.body;
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ success: false, message: 'No filenames provided for dry run.' });
    }

    if (!db.isConnected()) await db.initPool();
    const countRows = await db.query('SELECT COUNT(*) as count FROM designs WHERE is_active >= 0');
    const totalCount = countRows && countRows[0] ? countRows[0].count : 0;

    if (totalCount === 0) {
      return res.json({
        success: true,
        isEmpty: true,
        message: 'Import your spreadsheet first. Product catalog has 0 designs.',
        matchedCount: 0,
        unmatchedCount: filenames.length,
        ambiguousCount: 0,
        results: []
      });
    }

    const allDesignsCache = await db.query('SELECT id, title, sku FROM designs WHERE is_active >= 0 LIMIT 1000');

    let matchedCount = 0;
    let unmatchedCount = 0;
    let ambiguousCount = 0;
    const results = [];

    for (const name of filenames) {
      const match = await findMatchingDesignForZip(name, allDesignsCache);
      if (match.status === 'matched') {
        matchedCount++;
        results.push({
          filename: name,
          status: 'matched',
          design: { id: match.design.id, sku: match.design.sku, title: match.design.title },
          matchedBy: match.matchedBy
        });
      } else if (match.status === 'ambiguous') {
        ambiguousCount++;
        results.push({
          filename: name,
          status: 'ambiguous',
          candidates: (match.candidates || []).map(c => ({ id: c.id, sku: c.sku, title: c.title })),
          matchedBy: match.matchedBy
        });
      } else {
        unmatchedCount++;
        results.push({
          filename: name,
          status: 'unmatched',
          suggestions: match.suggestions || [],
          reason: match.reason
        });
      }
    }

    return res.json({
      success: true,
      isEmpty: false,
      total: filenames.length,
      matchedCount,
      unmatchedCount,
      ambiguousCount,
      results
    });
  } catch (err) {
    console.error('[Bulk ZIP Dry-Run Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Handles individual chunk uploads for files > 5MB.
 * Writes chunk to temp_chunks/<uploadId>/chunk_<chunkIndex>
 */
exports.bulkZipChunk = async (req, res) => {
  try {
    const uploadId = (req.body.uploadId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    const chunkIndex = parseInt(req.body.chunkIndex, 10);
    const totalChunks = parseInt(req.body.totalChunks, 10);

    if (!uploadId || isNaN(chunkIndex) || !req.file) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(400).json({ success: false, message: 'Invalid chunk parameters or missing chunk file.' });
    }

    const chunkDir = path.join(storage.getUploadsDir(), 'temp_chunks', uploadId);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const targetChunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);
    try {
      fs.renameSync(req.file.path, targetChunkPath);
    } catch (_) {
      fs.copyFileSync(req.file.path, targetChunkPath);
      fs.unlinkSync(req.file.path);
    }

    return res.json({
      success: true,
      uploadId,
      chunkIndex,
      totalChunks
    });
  } catch (err) {
    console.error('[Bulk ZIP Chunk Error]:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Merges chunks, verifies SHA-256 checksum, validates ZIP, runs matcher,
 * saves to private storage, calls replaceMachineFile.
 */
exports.bulkZipComplete = async (req, res) => {
  const uploadId = (req.body.uploadId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  const totalChunks = parseInt(req.body.totalChunks, 10);
  const originalName = (req.body.originalName || 'file.zip').trim();

  const chunkDir = path.join(storage.getUploadsDir(), 'temp_chunks', uploadId);
  const tempCombinedDir = path.join(storage.getUploadsDir(), 'temp_combined');
  const tempUnmatchedDir = path.join(storage.getUploadsDir(), 'temp_unmatched_zips');

  if (!fs.existsSync(tempCombinedDir)) fs.mkdirSync(tempCombinedDir, { recursive: true });
  if (!fs.existsSync(tempUnmatchedDir)) fs.mkdirSync(tempUnmatchedDir, { recursive: true });

  const safeName = path.basename(originalName).replace(/[/\\?%*:|"<>]/g, '_');
  const combinedPath = path.join(tempCombinedDir, `${uploadId}_${safeName}`);

  try {
    if (!uploadId || isNaN(totalChunks) || totalChunks <= 0 || !fs.existsSync(chunkDir)) {
      return res.status(400).json({
        status: 'failed',
        filename: originalName,
        error: 'Upload session not found or chunks missing.'
      });
    }

    // Verify all chunks exist
    for (let i = 0; i < totalChunks; i++) {
      const cPath = path.join(chunkDir, `chunk_${i}`);
      if (!fs.existsSync(cPath)) {
        return res.status(400).json({
          status: 'failed',
          filename: originalName,
          error: `Missing chunk ${i} of ${totalChunks}. Please retry upload.`
        });
      }
    }

    // Combine chunks sequentially
    const writeStream = fs.createWriteStream(combinedPath);
    for (let i = 0; i < totalChunks; i++) {
      const cPath = path.join(chunkDir, `chunk_${i}`);
      const data = fs.readFileSync(cPath);
      writeStream.write(data);
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Check file size limit from Settings
    const fileStats = fs.statSync(combinedPath);
    const finalSize = fileStats.size;
    const maxMb = parseInt(await Setting.get('max_upload_zip_size_mb', '100'), 10) || 100;
    if (finalSize > maxMb * 1024 * 1024) {
      try { fs.unlinkSync(combinedPath); } catch (_) {}
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}
      return res.json({
        status: 'failed',
        filename: originalName,
        error: `File size (${(finalSize / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit (${maxMb} MB).`
      });
    }

    // Calculate SHA-256 Checksum
    const hash = crypto.createHash('sha256');
    const fileBuffer = fs.readFileSync(combinedPath);
    hash.update(fileBuffer);
    const checksum = hash.digest('hex');

    // Validate ZIP contents & check for Zip Slip and executables
    const validation = validateMachineFileOrZip(combinedPath, originalName);
    if (!validation.isValid) {
      try { fs.unlinkSync(combinedPath); } catch (_) {}
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}
      return res.json({
        status: 'failed',
        filename: originalName,
        error: validation.reason
      });
    }

    // Run Matcher
    let allDesignsCache = null;
    try {
      allDesignsCache = await db.query('SELECT id, title, sku FROM designs WHERE is_active >= 0 LIMIT 500');
    } catch (_) {}

    const matchResult = await findMatchingDesignForZip(originalName, allDesignsCache);

    if (matchResult.status === 'matched') {
      const matchedDesign = matchResult.design;

      // Save to private persistent design storage (outside public web root)
      const savedKey = await storage.savePrivateFile(combinedPath, originalName, 'application/zip', matchedDesign.id);

      // Atomically replace file in DB without modifying download_count
      await Design.replaceMachineFile(
        matchedDesign.id,
        savedKey,
        originalName,
        finalSize,
        checksum,
        validation.detectedFormats
      );

      // Clean up temp files & chunks
      try { fs.unlinkSync(combinedPath); } catch (_) {}
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}

      await ActivityLog.logFromReq(
        req,
        'bulk_upload_zip_linked',
        'design',
        matchedDesign.id,
        `Bulk linked machine file "${originalName}" to design #${matchedDesign.id} (${matchedDesign.sku || matchedDesign.title})`
      );

      return res.json({
        status: 'matched',
        filename: originalName,
        designId: matchedDesign.id,
        title: matchedDesign.title,
        sku: matchedDesign.sku,
        formats: validation.detectedFormats,
        size: finalSize,
        checksum,
        matchedBy: matchResult.matchedBy
      });

    } else if (matchResult.status === 'ambiguous') {
      const ext = path.extname(originalName).toLowerCase();
      const randomHex = crypto.randomBytes(6).toString('hex');
      const tempFilename = `ambiguous-${Date.now()}-${randomHex}${ext}`;
      const destTempPath = path.join(tempUnmatchedDir, tempFilename);

      try {
        fs.renameSync(combinedPath, destTempPath);
      } catch (_) {
        fs.copyFileSync(combinedPath, destTempPath);
        fs.unlinkSync(combinedPath);
      }
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}

      return res.json({
        status: 'ambiguous',
        filename: originalName,
        tempToken: tempFilename,
        candidates: matchResult.candidates.map(c => ({ id: c.id, sku: c.sku, title: c.title })),
        detectedFormats: validation.detectedFormats,
        size: finalSize,
        checksum,
        reason: `Ambiguous match: multiple products share SKU or Title (${matchResult.candidates.length} candidates).`,
        matchedBy: matchResult.matchedBy
      });

    } else {
      const ext = path.extname(originalName).toLowerCase();
      const randomHex = crypto.randomBytes(6).toString('hex');
      const tempFilename = `unmatched-${Date.now()}-${randomHex}${ext}`;
      const destTempPath = path.join(tempUnmatchedDir, tempFilename);

      try {
        fs.renameSync(combinedPath, destTempPath);
      } catch (_) {
        fs.copyFileSync(combinedPath, destTempPath);
        fs.unlinkSync(combinedPath);
      }
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}

      return res.json({
        status: 'unmatched',
        filename: originalName,
        tempToken: tempFilename,
        suggestions: matchResult.suggestions || [],
        detectedFormats: validation.detectedFormats,
        size: finalSize,
        checksum,
        reason: matchResult.reason || 'No matching product found by SKU, Product ID, Title, or Import Filename.'
      });
    }

  } catch (err) {
    console.error('[Bulk ZIP Complete Error]:', err);
    try { if (fs.existsSync(combinedPath)) fs.unlinkSync(combinedPath); } catch (_) {}
    try { if (fs.existsSync(chunkDir)) fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}
    return res.status(500).json({
      status: 'failed',
      filename: originalName,
      error: err.message
    });
  }
};

/**
 * Direct Upload for Small Files (<= 5MB, 1-2 files per batch)
 */
exports.bulkUploadZipsDirect = async (req, res) => {
  try {
    const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files were uploaded in this batch.',
        matched: [],
        unmatched: [],
        ambiguous: [],
        failed: []
      });
    }

    cleanupTempUnmatchedZips();

    let allDesignsCache = null;
    try {
      allDesignsCache = await db.query('SELECT id, title, sku FROM designs WHERE is_active >= 0 LIMIT 500');
    } catch (_) {}

    const tempUnmatchedDir = path.join(storage.getUploadsDir(), 'temp_unmatched_zips');
    if (!fs.existsSync(tempUnmatchedDir)) fs.mkdirSync(tempUnmatchedDir, { recursive: true });

    const matched = [];
    const unmatched = [];
    const ambiguous = [];
    const failed = [];

    for (const file of files) {
      const originalName = file.originalname;
      try {
        // Validate file
        const validation = validateMachineFileOrZip(file.path, originalName);
        if (!validation.isValid) {
          if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (_) {}
          }
          failed.push({
            filename: originalName,
            error: validation.reason
          });
          continue;
        }

        // Checksum
        const fileBuffer = fs.readFileSync(file.path);
        const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        // Matcher
        const matchResult = await findMatchingDesignForZip(originalName, allDesignsCache);

        if (matchResult.status === 'matched') {
          const matchedDesign = matchResult.design;

          // Save to private storage
          const savedKey = await storage.savePrivateFile(file.path, originalName, 'application/zip', matchedDesign.id);

          // Atomic replacement
          await Design.replaceMachineFile(
            matchedDesign.id,
            savedKey,
            originalName,
            file.size,
            checksum,
            validation.detectedFormats
          );

          if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (_) {}
          }

          matched.push({
            filename: originalName,
            designId: matchedDesign.id,
            title: matchedDesign.title,
            sku: matchedDesign.sku,
            formats: validation.detectedFormats,
            size: file.size,
            checksum,
            matchedBy: matchResult.matchedBy
          });

        } else if (matchResult.status === 'ambiguous') {
          const ext = path.extname(originalName).toLowerCase();
          const randomHex = crypto.randomBytes(6).toString('hex');
          const tempFilename = `ambiguous-${Date.now()}-${randomHex}${ext}`;
          const destTempPath = path.join(tempUnmatchedDir, tempFilename);

          try {
            fs.renameSync(file.path, destTempPath);
          } catch (_) {
            fs.copyFileSync(file.path, destTempPath);
            fs.unlinkSync(file.path);
          }

          ambiguous.push({
            filename: originalName,
            tempToken: tempFilename,
            candidates: matchResult.candidates.map(c => ({ id: c.id, sku: c.sku, title: c.title })),
            detectedFormats: validation.detectedFormats,
            size: file.size,
            checksum,
            reason: `Ambiguous match: multiple products share SKU or Title (${matchResult.candidates.length} candidates).`,
            matchedBy: matchResult.matchedBy
          });

        } else {
          const ext = path.extname(originalName).toLowerCase();
          const randomHex = crypto.randomBytes(6).toString('hex');
          const tempFilename = `unmatched-${Date.now()}-${randomHex}${ext}`;
          const destTempPath = path.join(tempUnmatchedDir, tempFilename);

          try {
            fs.renameSync(file.path, destTempPath);
          } catch (_) {
            fs.copyFileSync(file.path, destTempPath);
            fs.unlinkSync(file.path);
          }

          unmatched.push({
            filename: originalName,
            tempToken: tempFilename,
            suggestions: matchResult.suggestions || [],
            detectedFormats: validation.detectedFormats,
            size: file.size,
            checksum,
            reason: matchResult.reason || 'No matching product found.'
          });
        }

      } catch (fErr) {
        if (file.path && fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (_) {}
        }
        failed.push({
          filename: originalName,
          error: fErr.message
        });
      }
    }

    if (matched.length > 0) {
      await ActivityLog.logFromReq(
        req,
        'bulk_zip_upload_batch',
        'design',
        null,
        `Bulk ZIP direct batch: ${matched.length} linked, ${unmatched.length} unmatched, ${ambiguous.length} ambiguous, ${failed.length} failed`
      );
    }

    return res.json({
      success: true,
      message: `Batch processed: ${matched.length} linked, ${unmatched.length} unmatched, ${ambiguous.length} ambiguous, ${failed.length} failed.`,
      matched,
      unmatched,
      ambiguous,
      failed,
      processedCount: files.length
    });

  } catch (err) {
    console.error('[Bulk ZIP Direct Fatal Error]:', err);
    return res.status(500).json({
      success: false,
      message: err.message,
      matched: [],
      unmatched: [],
      ambiguous: [],
      failed: [{ filename: 'batch', error: err.message }]
    });
  }
};

/**
 * Manually links an unmatched or ambiguous machine file to a specific design
 */
exports.linkSingleZip = async (req, res) => {
  try {
    const { designId, tempToken, originalName, checksum, detectedFormats } = req.body;
    if (!designId || !tempToken) {
      return res.status(400).json({ success: false, message: 'Design ID and file token are required.' });
    }

    const design = await Design.getById(designId);
    if (!design) {
      return res.status(404).json({ success: false, message: `Design #${designId} not found.` });
    }

    const tempDir = path.join(storage.getUploadsDir(), 'temp_unmatched_zips');
    const safeToken = path.basename(tempToken);
    const tempPath = path.join(tempDir, safeToken);

    if (!fs.existsSync(tempPath)) {
      return res.status(404).json({ success: false, message: 'Temporary file expired or not found. Please re-upload.' });
    }

    const finalName = originalName || safeToken;
    const stats = fs.statSync(tempPath);

    let finalFormats = detectedFormats;
    if (!finalFormats || !Array.isArray(finalFormats) || finalFormats.length === 0) {
      const val = validateMachineFileOrZip(tempPath, finalName);
      finalFormats = val.detectedFormats || [];
    }

    let finalChecksum = checksum;
    if (!finalChecksum) {
      finalChecksum = crypto.createHash('sha256').update(fs.readFileSync(tempPath)).digest('hex');
    }

    // Save to private persistent storage (outside public web root)
    const savedKey = await storage.savePrivateFile(tempPath, finalName, 'application/zip', design.id);

    // Atomically replace file in DB without touching download_count
    await Design.replaceMachineFile(design.id, savedKey, finalName, stats.size, finalChecksum, finalFormats);

    // Delete temp file
    try { fs.unlinkSync(tempPath); } catch (_) {}

    await ActivityLog.logFromReq(
      req,
      'link_bulk_zip_manual',
      'design',
      design.id,
      `Manually linked machine file "${finalName}" to design #${design.id} (${design.title})`
    );

    return res.json({
      success: true,
      message: `Successfully linked "${finalName}" to design #${design.id} (${design.sku || design.title})!`,
      designId: design.id,
      sku: design.sku,
      title: design.title,
      formats: finalFormats
    });

  } catch (err) {
    console.error('[Manual ZIP Link Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Endpoint to replace the ZIP file for a single design (Edit page & table row action)
 */
exports.replaceZipSingle = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
      if (isAjax) return res.status(400).json({ success: false, message: 'No machine file was uploaded.' });
      req.flash('error', 'No machine file was uploaded.');
      return res.redirect('back');
    }

    const design = await Design.getById(id);
    if (!design) {
      if (file.path && fs.existsSync(file.path)) try { fs.unlinkSync(file.path); } catch (_) {}
      const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
      if (isAjax) return res.status(404).json({ success: false, message: 'Design not found.' });
      req.flash('error', 'Design not found.');
      return res.redirect('back');
    }

    // Validate
    const validation = validateMachineFileOrZip(file.path, file.originalname);
    if (!validation.isValid) {
      if (file.path && fs.existsSync(file.path)) try { fs.unlinkSync(file.path); } catch (_) {}
      const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
      if (isAjax) return res.status(400).json({ success: false, message: validation.reason });
      req.flash('error', validation.reason);
      return res.redirect('back');
    }

    // Checksum
    const fileBuffer = fs.readFileSync(file.path);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Save to private storage
    const savedKey = await storage.savePrivateFile(file.path, file.originalname, 'application/zip', design.id);

    // Atomically replace file in DB without touching download_count
    await Design.replaceMachineFile(design.id, savedKey, file.originalname, file.size, checksum, validation.detectedFormats);

    if (file.path && fs.existsSync(file.path)) try { fs.unlinkSync(file.path); } catch (_) {}

    await ActivityLog.logFromReq(
      req,
      'replace_machine_file',
      'design',
      design.id,
      `Replaced machine file for design #${design.id} with "${file.originalname}"`
    );

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.json({
        success: true,
        message: `Machine file for "${design.title}" updated successfully!`,
        designId: design.id,
        formats: validation.detectedFormats,
        fileName: file.originalname,
        fileSize: file.size
      });
    }

    req.flash('success', `Machine file for "${design.title}" updated successfully!`);
    return res.redirect('back');

  } catch (err) {
    console.error('[replaceZipSingle error]:', err);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) return res.status(500).json({ success: false, message: err.message });
    req.flash('error', `Failed to replace machine file: ${err.message}`);
  }
};

exports.validateMachineFileOrZip = validateMachineFileOrZip;
exports.findMatchingDesignForZip = findMatchingDesignForZip;

/**
 * Bulk Update Design Details - View
 */
exports.getBulkDetails = async (req, res, next) => {
  try {
    const stats = await AdminStatsService.getDesignStats();
    res.render('admin/designs/bulk-details', {
      title: 'Bulk Update Design Details - Admin',
      stats,
      csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || '')
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk Update Design Details - Download Excel Template
 */
exports.downloadBulkDetailsTemplate = async (req, res, next) => {
  try {
    const buffer = bulkDesignDetailsService.generateTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="aruvi_design_details_template.xlsx"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk Update Design Details - Parse Input & Return Preview
 */
exports.postBulkDetailsPreview = async (req, res, next) => {
  try {
    const clearFieldOption = req.body.clear_field_option === '1' || req.body.clear_field_option === true;
    const notes = req.body.notes || '';
    const file = req.file || null;

    if (!file && (!notes || !notes.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please paste structured notes or upload a file (.xlsx, .xls, .docx, .pdf, .txt) to proceed.'
      });
    }

    const parsedEntries = await bulkDesignDetailsService.parseRawInput({
      file,
      notes,
      clearFieldOption
    });

    if (file && file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }

    const preview = await bulkDesignDetailsService.buildPreview(parsedEntries, clearFieldOption);

    return res.json({
      success: true,
      preview
    });
  } catch (err) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    return res.status(400).json({
      success: false,
      message: err.message || 'Unable to parse input for bulk update.'
    });
  }
};

/**
 * Bulk Update Design Details - Apply Confirmed Changes
 */
exports.postBulkDetailsApply = async (req, res, next) => {
  try {
    let items = req.body.items;
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          message: 'Malformed items payload.'
        });
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No designs selected for update.'
      });
    }

    const result = await bulkDesignDetailsService.applyBulkUpdate(items, req);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to apply bulk updates.'
    });
  }
};

/**
 * Bulk Update Design Details - Download Error Report
 */
exports.downloadBulkDetailsErrorReport = async (req, res, next) => {
  try {
    let failedRows = req.body.failedRows;
    if (typeof failedRows === 'string') {
      try {
        failedRows = JSON.parse(failedRows);
      } catch (e) {
        failedRows = [];
      }
    }
    const buffer = bulkDesignDetailsService.generateErrorReport(failedRows || []);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bulk_details_error_report.xlsx"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};


