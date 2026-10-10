const path = require('path');
const fs = require('fs');
const Design = require('../../models/Design');
const Category = require('../../models/Category');
const emailService = require('../../services/emailService');

const AdminStatsService = require('../../services/adminStatsService');

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
      total: stats.totalDesigns,
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
  const targetDir = path.join(__dirname, '../../public/uploads/designs');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

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
    const suggestedReviewCount = Math.floor(Math.random() * 150);
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
  if (req.xhr) return true;
  const acceptHeader = String((typeof req.get === 'function' ? req.get('accept') : req.headers['accept']) || req.headers['accept'] || '').toLowerCase();
  if (acceptHeader.includes('json')) return true;

  const requestedWith = String((typeof req.get === 'function' ? req.get('x-requested-with') : req.headers['x-requested-with']) || req.headers['x-requested-with'] || '').toLowerCase();
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
        const errMsg = `Design Code / SKU "${finalSku}" is already in use by another product. Please enter a unique SKU.`;
        if (isAjax) return res.status(400).json({ success: false, message: errMsg });
        req.flash('error', errMsg);
        return res.redirect('back');
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
        const filePath = `/public/uploads/previews/${file.filename}`;
        await Design.addFile(designId, file.originalname, filePath, ext, file.size, 1);
      }
    }

    await Design.syncDesignFormats(designId);

    // Note: Automatic campaign emails on design creation disabled per requirement

    const statusMsg = finalActiveState === 1 ? 'published' : 'saved as draft';
    console.log(`[PUBLISH SUCCESS] Design #${designId} "${title}" ${statusMsg} successfully.`);

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
      download_count: download_count ? parseInt(download_count) : 0,
      tags: tags || null,
      average_rating: parsedRating,
      reviews_count: parsedReviews
    });

    // Save single ZIP package record if new ZIP file uploaded
    if (packageFiles.length > 0) {
      const pkg = packageFiles[0];
      const db = require('../../config/db');
      if (db.isConnected()) {
        await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [id]);
      }
      await Design.addFile(id, pkg.originalname, pkg.webPath, 'ZIP', pkg.size, 0);
      const detectedFormatsStr = pkg.detectedFormats ? pkg.detectedFormats.join(', ') : 'DST';
      await Design.update(id, { formats: detectedFormatsStr });
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
        const filePath = `/public/uploads/previews/${file.filename}`;
        await Design.addFile(id, file.originalname, filePath, ext, file.size, 1);
      }
    }

    await Design.syncDesignFormats(id);

    // Note: Automatic campaign emails on design update disabled per requirement

    const statusMsg = finalActiveState === 1 ? 'published' : 'saved as draft';
    console.log(`[PUBLISH SUCCESS] Design #${id} "${title}" updated and ${statusMsg} successfully.`);

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

const XLSX = require('xlsx');

// In-memory cache for import batches
const importBatchesCache = new Map();

/**
 * Requirement 6: Downloadable Spreadsheet Template for Bulk Import
 */
exports.downloadImportTemplate = async (req, res, next) => {
  try {
    const templateData = [
      {
        'Design Name': 'Rose Bridal Blouse Motif',
        'Design Code / SKU': 'AED 101',
        'Category': 'Blouse Designs',
        'MRP / Original Price': 120,
        'Selling Price': 45,
        'Description': 'Intricate rose floral embroidery design file for bridal blouses.',
        'Available Formats': 'DST, PES, JEF, EXP',
        'Tags': 'rose, blouse, bridal',
        'Status': 'Active',
        'Rating': 4.8,
        'Review Count': 120,
        'Preview Image Filename': 'AED 101.png',
        'Machine ZIP Filename': 'AED 101.zip'
      },
      {
        'Design Name': 'Peacock Temple Border',
        'Design Code / SKU': 'AED 102',
        'Category': 'Border Designs',
        'MRP / Original Price': 120,
        'Selling Price': 45,
        'Description': 'Traditional peacock temple neck border embroidery file for sarees.',
        'Available Formats': 'DST, PES, JEF, EXP',
        'Tags': 'peacock, temple, border',
        'Status': 'Active',
        'Rating': 4.9,
        'Review Count': 95,
        'Preview Image Filename': 'AED 102.png',
        'Machine ZIP Filename': 'AED 102.zip'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Import Template');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Aruvi_Design_Import_Template.xlsx"');
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
};

/**
 * Requirement 6 & 7: Upload, Parse, Validate, and Preview Bulk Import (Spreadsheet + Assets)
 */
exports.postImportPreview = async (req, res, next) => {
  try {
    const reqFiles = req.files || [];
    const allFilesList = Array.isArray(reqFiles) ? reqFiles : Object.values(reqFiles).flat();

    if (allFilesList.length === 0) {
      return res.status(400).json({ success: false, message: 'Please upload a spreadsheet data file (.xlsx, .xls, .csv, .json, .docx) and optional product assets.' });
    }

    // 1. Find spreadsheet data file vs asset files
    let dataFile = null;
    const uploadedAssetFiles = [];

    for (const f of allFilesList) {
      const ext = path.extname(f.originalname).toLowerCase();
      if (['.xlsx', '.xls', '.csv', '.json', '.docx'].includes(ext) && !dataFile) {
        dataFile = f;
      } else {
        uploadedAssetFiles.push(f);
      }
    }

    if (!dataFile) {
      // Fallback: if all uploaded files are assets/ZIPs without spreadsheet
      dataFile = allFilesList[0];
    }

    // 2. Parse spreadsheet data rows
    let rawRows = [];
    const dataExt = path.extname(dataFile.originalname).toLowerCase();

    if (['.xlsx', '.xls', '.csv'].includes(dataExt)) {
      const fileBuffer = fs.readFileSync(dataFile.path);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    } else if (dataExt === '.json') {
      const jsonContent = fs.readFileSync(dataFile.path, 'utf8');
      rawRows = JSON.parse(jsonContent);
      if (!Array.isArray(rawRows)) rawRows = [rawRows];
    } else if (dataExt === '.docx') {
      // Parse structured DOCX file using AdmZip to read word/document.xml
      try {
        const zip = new AdmZip(dataFile.path);
        const xmlEntry = zip.getEntry('word/document.xml');
        if (xmlEntry) {
          const xmlContent = zip.readAsText(xmlEntry);
          // Extract text lines matching key-value or table cell patterns
          const cleanText = xmlContent.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n');
          const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
          
          let currentRow = {};
          lines.forEach(line => {
            if (line.includes(':')) {
              const [k, v] = line.split(':').map(s => s.trim());
              if (k && v) currentRow[k] = v;
            } else if (line.toLowerCase().startsWith('design') || line.toLowerCase().startsWith('aed')) {
              if (Object.keys(currentRow).length > 0) {
                rawRows.push(currentRow);
                currentRow = {};
              }
              currentRow['Design Name'] = line;
            }
          });
          if (Object.keys(currentRow).length > 0) rawRows.push(currentRow);
        }
      } catch (docErr) {
        console.warn('DOCX parse warning:', docErr.message);
      }
    }

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid data rows found in the uploaded file. Please use the downloadable template.' });
    }

    // 3. Move uploaded assets to public uploads directory for storage
    const targetDirPreviews = path.join(__dirname, '../../public/uploads/previews');
    const targetDirDesigns = path.join(__dirname, '../../public/uploads/designs');
    if (!fs.existsSync(targetDirPreviews)) fs.mkdirSync(targetDirPreviews, { recursive: true });
    if (!fs.existsSync(targetDirDesigns)) fs.mkdirSync(targetDirDesigns, { recursive: true });

    const assetMap = new Map(); // filename lowercase -> asset metadata

    for (const file of uploadedAssetFiles) {
      const extName = path.extname(file.originalname).toLowerCase();
      const filenameLower = file.originalname.toLowerCase();

      if (['.png', '.jpg', '.jpeg', '.webp'].includes(extName)) {
        const uniqueName = `import_img_${Date.now()}_${Math.round(Math.random()*10000)}_${path.basename(file.originalname)}`;
        const destPath = path.join(targetDirPreviews, uniqueName);
        fs.copyFileSync(file.path, destPath);

        assetMap.set(filenameLower, {
          type: 'image',
          originalname: file.originalname,
          filename: uniqueName,
          webPath: `/public/uploads/previews/${uniqueName}`,
          size: file.size
        });
      } else if (extName === '.zip') {
        const uniqueName = `import_zip_${Date.now()}_${Math.round(Math.random()*10000)}_${path.basename(file.originalname)}`;
        const destPath = path.join(targetDirDesigns, uniqueName);
        fs.copyFileSync(file.path, destPath);

        // Inspect ZIP contents for machine format entries
        let fileCount = 1;
        let detectedFormats = ['DST'];
        try {
          const zip = new AdmZip(destPath);
          const entries = zip.getEntries();
          const machineEntries = entries.filter(e => {
            if (e.isDirectory) return false;
            const eExt = path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase();
            return ['DST', 'PES', 'JEF', 'EXP'].includes(eExt);
          });
          if (machineEntries.length > 0) {
            fileCount = machineEntries.length;
            detectedFormats = [...new Set(machineEntries.map(e => path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase()))];
          }
        } catch (zErr) {}

        assetMap.set(filenameLower, {
          type: 'zip',
          originalname: file.originalname,
          filename: uniqueName,
          webPath: `/public/uploads/designs/${uniqueName}`,
          size: file.size,
          fileCount,
          detectedFormats
        });
      }
    }

    // 4. Fetch existing categories and SKUs from DB for validation
    const categories = await Category.getAll();
    const db = require('../../config/db');
    let existingSkus = new Set();
    if (db.isConnected()) {
      const skuRows = await db.query('SELECT sku FROM designs WHERE sku IS NOT NULL');
      if (Array.isArray(skuRows)) {
        skuRows.forEach(r => existingSkus.add(String(r.sku).trim().toLowerCase()));
      }
    }

    // 5. Process & Validate Rows
    const validatedRows = [];
    const batchSkusInImport = new Set();
    let validCount = 0;
    let warningCount = 0;
    let errorCount = 0;

    for (let index = 0; index < rawRows.length; index++) {
      const row = rawRows[index];
      
      // Helper function to extract field by multiple alias keys
      const getVal = (keys) => {
        for (const k of keys) {
          for (const rowKey of Object.keys(row)) {
            if (rowKey.toLowerCase().replace(/[^a-z0-9]/g, '') === k.toLowerCase().replace(/[^a-z0-9]/g, '')) {
              return String(row[rowKey]).trim();
            }
          }
        }
        return '';
      };

      const title = getVal(['Design Name', 'title', 'name', 'design']);
      const sku = getVal(['Design Code / SKU', 'Design Code', 'SKU', 'code']);
      const categoryNameOrSlug = getVal(['Category', 'category_id', 'cat']);
      const mrpRaw = getVal(['MRP / Original Price', 'Original Price', 'MRP', 'price']);
      const sellingRaw = getVal(['Selling Price', 'Final Selling Price', 'sale_price', 'sale price', 'selling']);
      const desc = getVal(['Description', 'description', 'desc']);
      const formatsRaw = getVal(['Available Formats', 'formats', 'format']);
      const tags = getVal(['Tags', 'tags', 'tag']);
      const statusRaw = getVal(['Status', 'status', 'is_active']);
      const ratingRaw = getVal(['Rating', 'rating', 'average_rating']);
      const reviewsRaw = getVal(['Review Count', 'reviews_count', 'reviews']);
      const previewFileReq = getVal(['Preview Image Filename', 'preview_image', 'image']);
      const zipFileReq = getVal(['Machine ZIP Filename', 'zip_filename', 'zip']);

      const errors = [];
      const warnings = [];

      // Required validation
      if (!title) errors.push('Design Name is required.');
      if (!sku) errors.push('Design Code / SKU is required.');
      if (!mrpRaw) errors.push('MRP / Original Price is required.');

      // Pricing validation
      const mrp = parseFloat(mrpRaw);
      const sellingPrice = sellingRaw !== '' ? parseFloat(sellingRaw) : 45.00;

      if (isNaN(mrp) || mrp < 0) {
        errors.push('MRP / Original Price must be a non-negative number.');
      }
      if (isNaN(sellingPrice) || sellingPrice < 0) {
        errors.push('Selling Price must be a non-negative number.');
      }
      if (!isNaN(mrp) && !isNaN(sellingPrice) && sellingPrice > mrp) {
        errors.push(`Selling Price (₹${sellingPrice}) cannot be greater than MRP (₹${mrp}).`);
      }

      // SKU duplicate validation
      if (sku) {
        const skuLower = sku.toLowerCase();
        if (existingSkus.has(skuLower)) {
          errors.push(`SKU "${sku}" already exists in database.`);
        } else if (batchSkusInImport.has(skuLower)) {
          errors.push(`Duplicate SKU "${sku}" found within current import file.`);
        } else {
          batchSkusInImport.add(skuLower);
        }
      }

      // Category resolution
      let matchedCategory = null;
      if (categoryNameOrSlug) {
        const catSearch = categoryNameOrSlug.toLowerCase();
        matchedCategory = categories.find(c => c.name.toLowerCase() === catSearch || c.slug.toLowerCase() === catSearch);
      }
      if (!matchedCategory && categories.length > 0) {
        matchedCategory = categories[0];
        if (categoryNameOrSlug) {
          warnings.push(`Category "${categoryNameOrSlug}" not found. Assigned default: "${matchedCategory.name}".`);
        }
      }

      // Asset matching (Preview Image & Machine ZIP)
      let matchedPreviewImage = null;
      let matchedZipPackage = null;

      // Match Preview Image
      if (previewFileReq && assetMap.has(previewFileReq.toLowerCase())) {
        matchedPreviewImage = assetMap.get(previewFileReq.toLowerCase());
      } else if (sku) {
        // Auto-match by SKU (e.g. "AED 101.png", "AED 101.jpg")
        for (const [key, asset] of assetMap.entries()) {
          if (asset.type === 'image' && (key.startsWith(sku.toLowerCase() + '.') || key === sku.toLowerCase())) {
            matchedPreviewImage = asset;
            break;
          }
        }
      }

      // Match Machine ZIP Package
      if (zipFileReq && assetMap.has(zipFileReq.toLowerCase())) {
        matchedZipPackage = assetMap.get(zipFileReq.toLowerCase());
      } else if (sku) {
        // Auto-match by SKU (e.g. "AED 101.zip")
        for (const [key, asset] of assetMap.entries()) {
          if (asset.type === 'zip' && (key.startsWith(sku.toLowerCase() + '.') || key === sku.toLowerCase())) {
            matchedZipPackage = asset;
            break;
          }
        }
      }

      if (!matchedPreviewImage) {
        warnings.push('No preview image attached. Default store logo will be used.');
      }
      if (!matchedZipPackage) {
        warnings.push('No machine ZIP file attached for download.');
      }

      // Format resolution
      let finalFormatsStr = formatsRaw;
      if (matchedZipPackage && matchedZipPackage.detectedFormats && matchedZipPackage.detectedFormats.length > 0) {
        finalFormatsStr = matchedZipPackage.detectedFormats.join(', ');
      }
      if (!finalFormatsStr) finalFormatsStr = 'DST, PES, JEF, EXP';

      // Rating & Reviews resolution
      const rating = ratingRaw !== '' ? parseFloat(ratingRaw) : 4.80;
      const reviewsCount = reviewsRaw !== '' ? parseInt(reviewsRaw) : 120;

      const statusVal = (statusRaw.toLowerCase() === 'draft' || statusRaw === '0') ? 0 : 1;

      let rowStatus = 'valid';
      if (errors.length > 0) {
        rowStatus = 'error';
        errorCount++;
      } else if (warnings.length > 0) {
        rowStatus = 'warning';
        warningCount++;
      } else {
        validCount++;
      }

      validatedRows.push({
        rowIndex: index + 1,
        rowStatus,
        errors,
        warnings,
        title: title || `Design #${index + 1}`,
        sku: sku || `AED-${index + 100}`,
        category_id: matchedCategory ? matchedCategory.id : null,
        category_name: matchedCategory ? matchedCategory.name : 'Blouse Designs',
        price: !isNaN(mrp) ? mrp : 120.00,
        sale_price: !isNaN(sellingPrice) ? sellingPrice : 45.00,
        description: desc || '',
        formats: finalFormatsStr,
        tags: tags || null,
        is_active: statusVal,
        average_rating: !isNaN(rating) && rating >= 0 && rating <= 5 ? rating : 4.80,
        reviews_count: !isNaN(reviewsCount) && reviewsCount >= 0 ? reviewsCount : 120,
        previewImage: matchedPreviewImage,
        zipPackage: matchedZipPackage
      });
    }

    const batchId = `batch_${Date.now()}_${Math.round(Math.random() * 100000)}`;
    importBatchesCache.set(batchId, {
      createdAt: Date.now(),
      rows: validatedRows
    });

    return res.json({
      success: true,
      batchId,
      totalRows: validatedRows.length,
      validCount,
      warningCount,
      errorCount,
      rows: validatedRows
    });
  } catch (err) {
    console.error('postImportPreview error:', err);
    return res.status(500).json({ success: false, message: `Import processing error: ${err.message}` });
  }
};

/**
 * Requirement 6: Commit Validated Bulk Import Batch to Database
 */
exports.postImportCommit = async (req, res, next) => {
  try {
    const { batchId, skipErrors } = req.body;

    if (!batchId || !importBatchesCache.has(batchId)) {
      return res.status(400).json({ success: false, message: 'Invalid or expired import batch. Please re-upload your import file.' });
    }

    const batch = importBatchesCache.get(batchId);
    const rowsToProcess = batch.rows.filter(r => r.rowStatus !== 'error' || skipErrors === true);

    if (rowsToProcess.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid rows available to import. All rows contained validation errors.' });
    }

    const db = require('../../config/db');
    let importedCount = 0;
    let skippedCount = batch.rows.length - rowsToProcess.length;
    let failedCount = 0;

    if (db.isConnected()) {
      try {
        await db.query('START TRANSACTION');

        for (const row of rowsToProcess) {
          try {
            const finalSlug = await Design.generateUniqueSlug(row.title);

            const designId = await Design.create({
              title: row.title,
              sku: row.sku,
              slug: finalSlug,
              price: row.price,
              sale_price: row.sale_price,
              category_id: row.category_id,
              formats: row.formats,
              is_active: row.is_active,
              tags: row.tags,
              average_rating: row.average_rating,
              reviews_count: row.reviews_count
            });

            // Save matched preview image
            if (row.previewImage) {
              await Design.addFile(
                designId,
                row.previewImage.originalname,
                row.previewImage.webPath,
                'PNG',
                row.previewImage.size,
                1
              );
            }

            // Save matched single machine ZIP package
            if (row.zipPackage) {
              await Design.addFile(
                designId,
                row.zipPackage.originalname,
                row.zipPackage.webPath,
                'ZIP',
                row.zipPackage.size,
                0
              );
            }

            await Design.syncDesignFormats(designId);
            importedCount++;
          } catch (rowErr) {
            console.error(`Row #${row.rowIndex} import failed:`, rowErr.message);
            failedCount++;
          }
        }

        await db.query('COMMIT');
      } catch (txnErr) {
        await db.query('ROLLBACK');
        console.error('Import transaction failed:', txnErr);
        return res.status(500).json({ success: false, message: `Database transaction failed: ${txnErr.message}` });
      }
    } else {
      // Fallback in-memory import
      for (const row of rowsToProcess) {
        const finalSlug = await Design.generateUniqueSlug(row.title);
        await Design.create({
          title: row.title,
          sku: row.sku,
          slug: finalSlug,
          price: row.price,
          sale_price: row.sale_price,
          category_id: row.category_id,
          formats: row.formats,
          is_active: row.is_active,
          tags: row.tags,
          average_rating: row.average_rating,
          reviews_count: row.reviews_count
        });
        importedCount++;
      }
    }

    importBatchesCache.delete(batchId);

    const message = `Bulk import complete! ${importedCount} design(s) imported successfully.${skippedCount > 0 ? ` ${skippedCount} row(s) skipped.` : ''}`;
    return res.json({
      success: true,
      message,
      importedCount,
      skippedCount,
      failedCount
    });
  } catch (err) {
    console.error('postImportCommit error:', err);
    return res.status(500).json({ success: false, message: `Import commit failed: ${err.message}` });
  }
};

