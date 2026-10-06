const path = require('path');
const fs = require('fs');
const Design = require('../../models/Design');
const Category = require('../../models/Category');

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
    const activeCount = await Design.countActive();
    const inactiveCount = await Design.countInactive();

    res.render('admin/designs/index', {
      title: 'Manage Embroidery Designs - Admin',
      designs,
      categories,
      total,
      activeCount,
      inactiveCount,
      categoryCount: categories.length || 6,
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

exports.getCreateForm = async (req, res, next) => {
  try {
    const categories = await Category.getAll();
    res.render('admin/designs/form', {
      title: 'Add New Embroidery Design - Admin',
      design: null,
      categories
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
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags, status_draft
    } = req.body;

    const isAjax = checkIsAjax(req);

    if (!title || !price) {
      const errMsg = 'Design Name and Original Price are required.';
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
      sku: sku || `ARV-FL-${Math.floor(100 + Math.random() * 900)}`,
      slug: finalSlug,
      price: parseFloat(price),
      sale_price: sale_price && parseFloat(sale_price) > 0 ? parseFloat(sale_price) : null,
      category_id: category_id ? parseInt(category_id) : null,
      hoop_size: hoop_size || '5x7 inch (130x180 mm)',
      stitch_count: stitch_count ? parseInt(stitch_count) : 24800,
      dimensions: dimensions || '140mm x 180mm',
      formats: detectedFormatsStr,
      is_featured: is_featured ? 1 : 0,
      is_trending: is_trending ? 1 : 0,
      is_active: finalActiveState,
      download_count: download_count ? parseInt(download_count) : 0,
      tags: tags || null
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
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags, status_draft, selected_formats
    } = req.body;

    const isAjax = checkIsAjax(req);

    if (!title || !price) {
      const errMsg = 'Design Name and Original Price are required.';
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

    const finalActiveState = status_draft ? 0 : (is_active ? 1 : 0);

    // Process uploaded ZIP package
    const packageFiles = processUploadedFilesAndArchives(req.files);

    let baseSlugInput = (slug && slug.trim()) ? slug.trim() : (existingDesign.slug || title || `design-${id}`);
    const finalSlug = await Design.generateUniqueSlug(baseSlugInput, id);

    await Design.update(id, {
      title,
      sku: sku || existingDesign.sku || `ARV-FL-00${id}`,
      slug: finalSlug,
      price: parseFloat(price),
      sale_price: sale_price !== undefined && sale_price !== null && sale_price !== '' ? parseFloat(sale_price) : null,
      category_id: category_id ? parseInt(category_id) : null,
      hoop_size: hoop_size || existingDesign.hoop_size || '5x7 inch (130x180 mm)',
      stitch_count: stitch_count ? parseInt(stitch_count) : (existingDesign.stitch_count || 24800),
      dimensions: dimensions || existingDesign.dimensions || '140mm x 180mm',
      is_featured: is_featured ? 1 : 0,
      is_trending: is_trending ? 1 : 0,
      is_active: finalActiveState,
      download_count: download_count ? parseInt(download_count) : (existingDesign.download_count || 0),
      tags: tags || null
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

