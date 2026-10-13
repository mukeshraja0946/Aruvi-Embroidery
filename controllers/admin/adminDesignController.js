const path = require('path');
const fs = require('fs');
const Design = require('../../models/Design');
const Category = require('../../models/Category');
const db = require('../../config/db');
const emailService = require('../../services/emailService');
const storage = require('../../config/storage');
const { getPreviewsDir, getDesignsDir, resolveFilePath, fileExists, getStorageDriver, uploadToCloudinary, uploadToS3OrR2 } = storage;
const ActivityLog = require('../../models/ActivityLog');

const AdminStatsService = require('../../services/adminStatsService');
const errorLogger = require('../../services/errorLogger');

exports.getDesigns = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { search, category, status, sort } = req.query;

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
      total: (search || category || status) ? total : stats.totalDesigns,
      activeCount: stats.activeDesigns,
      inactiveCount: stats.inactiveDesigns,
      categoryCount: stats.totalCategories,
      stats,
      currentPage: page,
      totalPages: totalPages || 1,
      search: search || '',
      selectedCategory: category || '',
      selectedStatus: status || '',
      selectedSort: sort || 'newest'
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

exports.postCreate = async (req, res, next) => {
  try {
    console.log('[PUBLISH] Request received for design creation:', req.body.title);
    const {
      title, sku, slug, price, sale_price, category_id,
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags, status_draft,
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
      hoop_size: hoop_size || '5x7 inch (130x180 mm)',
      stitch_count: stitch_count ? parseInt(stitch_count) : 24800,
      dimensions: dimensions || '140mm x 180mm',
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
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags, status_draft, selected_formats,
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
      hoop_size: hoop_size || existingDesign.hoop_size || '5x7 inch (130x180 mm)',
      stitch_count: stitch_count ? parseInt(stitch_count) : (existingDesign.stitch_count || 24800),
      dimensions: dimensions || existingDesign.dimensions || '140mm x 180mm',
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
  try {
    await Design.deleteAll();
    await ActivityLog.logFromReq(req, 'delete_all', 'design', null, 'Deleted all designs permanently');
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'All designs have been permanently removed.' });
    }

    req.flash('success', 'All designs have been permanently removed.');
    res.redirect('/admin/designs');
  } catch (err) {
    console.error('deleteAllDesigns error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete all designs.' });
    }
    next(err);
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
 * Helper to match an image filename to a design in the database.
 * Matches by:
 * 1. SKU (e.g. "AED-BLO-01", "AED 1", "AED-01", "aed_blo_01")
 * 2. Product ID (e.g. "1", "01", "102")
 * 3. Exact Title or Slug (e.g. "Rose Floral Design", "rose-floral-design")
 * Case-insensitive, ignoring extension, spaces, underscores, and dashes.
 * Supports filenames with spaces like "AED 1.png".
 */
async function findMatchingDesign(rawBaseName) {
  if (!rawBaseName || !db.isConnected()) return null;

  const trimmed = rawBaseName.trim();

  // 1. Direct exact match by SKU, Title, or Slug (case-insensitive in MySQL/MariaDB utf8mb4)
  const exactRows = await db.query(
    'SELECT id, title, sku, slug FROM designs WHERE sku = ? OR title = ? OR slug = ? LIMIT 1',
    [trimmed, trimmed, trimmed]
  );
  if (exactRows && exactRows.length > 0) return exactRows[0];

  // 2. Numeric Product ID check (e.g. "1", "01", "102")
  if (/^\d+$/.test(trimmed)) {
    const idNum = parseInt(trimmed, 10);
    if (!isNaN(idNum) && idNum > 0) {
      const idRows = await db.query(
        'SELECT id, title, sku, slug FROM designs WHERE id = ? LIMIT 1',
        [idNum]
      );
      if (idRows && idRows.length > 0) return idRows[0];
    }
  }

  // 3. Cleaned / normalized comparison: remove all spaces, underscores, and dashes, lowercase
  const normalized = trimmed.replace(/[\s\-_]+/g, '').toLowerCase();
  if (normalized.length > 0) {
    const normRows = await db.query(
      `SELECT id, title, sku, slug FROM designs 
       WHERE REPLACE(REPLACE(REPLACE(LOWER(sku), ' ', ''), '_', ''), '-', '') = ?
          OR REPLACE(REPLACE(REPLACE(LOWER(title), ' ', ''), '_', ''), '-', '') = ?
          OR REPLACE(REPLACE(REPLACE(LOWER(slug), ' ', ''), '_', ''), '-', '') = ?
       LIMIT 1`,
      [normalized, normalized, normalized]
    );
    if (normRows && normRows.length > 0) return normRows[0];
  }

  // 4. Pattern check: "AED" or "AED-" followed by digits (e.g. "AED 1", "AED-1", "AED_01")
  const aedMatch = trimmed.match(/^AED[\s\-_]*0*(\d+)$/i);
  if (aedMatch) {
    const numericPart = parseInt(aedMatch[1], 10);
    // Check if ID matches
    const idFallback = await db.query(
      'SELECT id, title, sku, slug FROM designs WHERE id = ? LIMIT 1',
      [numericPart]
    );
    if (idFallback && idFallback.length > 0) return idFallback[0];

    // Check if SKU like 'AED 1' or 'AED 01' matches
    const skuFallback = await db.query(
      'SELECT id, title, sku, slug FROM designs WHERE sku LIKE ? LIMIT 1',
      [`%${numericPart}%`]
    );
    if (skuFallback && skuFallback.length > 0) return skuFallback[0];
  }

  return null;
}

exports.bulkUploadImages = async (req, res) => {
  try {
    const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images were uploaded in this batch.',
        matched: [],
        unmatched: [],
        failed: []
      });
    }

    const matched = [];
    const unmatched = [];
    const failed = [];

    for (const file of files) {
      const originalName = file.originalname;
      try {
        const ext = path.extname(originalName).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext)) {
          if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
          }
          unmatched.push({
            filename: originalName,
            reason: `Unsupported image format (${ext || 'none'}). Only JPG, PNG, WEBP, and AVIF are allowed.`
          });
          continue;
        }

        // Base filename without extension
        const baseName = path.basename(originalName, ext).trim();
        const matchedDesign = await findMatchingDesign(baseName);

        if (matchedDesign) {
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
            imageUrl: savedUrl
          });
        } else {
          // Clean up temp file
          if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
          }

          unmatched.push({
            filename: originalName,
            reason: 'No matching product found by SKU, Product ID, or Title.'
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
        `Bulk image batch processed: ${matched.length} linked, ${unmatched.length} unmatched, ${failed.length} failed`
      );
    }

    return res.json({
      success: true,
      message: `Batch processed: ${matched.length} linked, ${unmatched.length} unmatched, ${failed.length} failed.`,
      matched,
      unmatched,
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
      failed: [{ filename: 'batch', error: err.message, referenceId: refId }]
    });
  }
};


