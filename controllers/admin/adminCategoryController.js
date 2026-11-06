const path = require('path');
const fs = require('fs');
const Category = require('../../models/Category');
const ActivityLog = require('../../models/ActivityLog');
const Setting = require('../../models/Setting');
const storage = require('../../config/storage');

function invalidateCategoryCaches(req) {
  Category.invalidateCache();
  Setting.invalidateCache();
  if (req && req.app && req.app.locals) {
    if (req.app.locals.siteSettings) {
      // Keep siteSettings up to date
    }
  }
}

function makeRefId() {
  return 'ERR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/**
 * Validates that an uploaded file is a genuine, uncorrupted image (JPG, PNG, WEBP) under 5MB.
 */
async function validateImageFile(file) {
  if (!file) return { valid: true };

  // 1. Max 5MB limit
  const MAX_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return { valid: false, message: 'Image size exceeds 5MB limit. Please upload an image under 5MB.' };
  }

  // 2. Extension check
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExts = ['.png', '.jpg', '.jpeg', '.webp'];
  if (!allowedExts.includes(ext)) {
    return { valid: false, message: 'Invalid format! Allowed formats: JPG, PNG, and WEBP.' };
  }

  // 3. Real image content validation using Sharp
  try {
    const { getSharp } = require('../../utils/sharpHelper');
    const sharp = getSharp();
    if (sharp) {
      const meta = await sharp(file.path).metadata();
      const validFormats = ['jpeg', 'png', 'webp'];
      if (!meta || !meta.format || !validFormats.includes(meta.format.toLowerCase())) {
        return { valid: false, message: `Invalid image content: detected format "${meta ? meta.format : 'unknown'}". Allowed: JPG, PNG, WEBP.` };
      }
    }
  } catch (err) {
    return { valid: false, message: `Corrupt or unreadable image file: ${err.message}` };
  }

  return { valid: true };
}

exports.getCategories = async (req, res, next) => {
  try {
    const { sort, search, status } = req.query;
    const categories = await Category.getAll({ sort: sort || 'newest', search, status });
    const allCategories = await Category.getAll();
    const countDisplay = await Setting.get('category_count_display', 'exact');
    const hideEmpty = await Setting.get('category_hide_empty', '0');
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : (res.locals.csrfToken || '');

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({
        success: true,
        categories: categories || [],
        countDisplay,
        hideEmpty
      });
    }

    res.render('admin/categories/index', {
      title: 'Manage Categories - Admin',
      categories: categories || [],
      allCategories: allCategories || [],
      currentSort: sort || 'newest',
      currentSearch: search || '',
      currentStatus: status || '',
      countDisplay,
      hideEmpty,
      csrfToken
    });
  } catch (err) {
    next(err);
  }
};

exports.postSettings = async (req, res, next) => {
  try {
    const { category_count_display, category_hide_empty } = req.body;
    const countDisplay = ['exact', 'rounded', 'hidden'].includes(category_count_display) ? category_count_display : 'exact';
    const hideEmpty = (category_hide_empty === '1' || category_hide_empty === 'on' || category_hide_empty === 'true') ? '1' : '0';

    await Setting.set('category_count_display', countDisplay);
    await Setting.set('category_hide_empty', hideEmpty);

    if (req.app && req.app.locals && req.app.locals.siteSettings) {
      req.app.locals.siteSettings.category_count_display = countDisplay;
      req.app.locals.siteSettings.category_hide_empty = hideEmpty;
    }
    invalidateCategoryCaches(req);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.json({ success: true, message: 'Category display settings updated successfully.' });
    }

    req.flash('success', 'Category display settings updated successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.postCreate = async (req, res, next) => {
  const refId = makeRefId();
  const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));

  try {
    const { name, slug, description, icon, display_order, sort_order, show_on_home, is_active } = req.body;
    const errors = {};

    if (!name || !name.trim()) {
      errors.name = 'Category name is required.';
    }

    const cleanName = (name || '').trim();
    const generatedSlug = slug && slug.trim() 
      ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') 
      : cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    if (!generatedSlug) {
      errors.slug = 'Valid slug is required.';
    } else {
      const isTaken = await Category.isSlugTaken(generatedSlug);
      if (isTaken) {
        errors.slug = `The slug "${generatedSlug}" is already taken by another category.`;
      }
    }

    // Validate real image content
    if (req.file) {
      const imgCheck = await validateImageFile(req.file);
      if (!imgCheck.valid) {
        errors.image = imgCheck.message;
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
    }

    if (Object.keys(errors).length > 0) {
      if (isAjax) {
        return res.status(422).json({ success: false, refId, message: 'Please correct the highlighted errors.', errors });
      }
      req.flash('error', Object.values(errors).join(' '));
      return res.redirect('/admin/categories');
    }

    let imageUrl = null;
    if (req.file) {
      imageUrl = await storage.savePublicFile(req.file.path, req.file.originalname, req.file.mimetype, 'categories');
      try {
        if (req.file.path && fs.existsSync(req.file.path) && req.file.path !== imageUrl) {
          fs.unlinkSync(req.file.path);
        }
      } catch (_) {}
    }

    const isHome = (show_on_home === undefined || show_on_home === '1' || show_on_home === 'on' || show_on_home === true || show_on_home === 1) ? 1 : 0;
    const activeVal = (is_active === undefined || is_active === '1' || is_active === 'on' || is_active === true || is_active === 1) ? 1 : 0;
    const ordVal = parseInt(sort_order !== undefined ? sort_order : display_order, 10) || 0;

    const newId = await Category.create({
      name: cleanName,
      slug: generatedSlug,
      description: description ? description.trim() : null,
      image_url: imageUrl,
      card_image_key: imageUrl,
      icon: icon || 'fa-solid fa-shapes',
      sort_order: ordVal,
      display_order: ordVal,
      show_on_home: isHome,
      is_active: activeVal
    });

    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'create', 'category', newId, `Created category: "${cleanName}"`);

    const createdCat = await Category.getById(newId);

    if (isAjax) {
      return res.json({
        success: true,
        message: `Category "${cleanName}" added successfully.`,
        category: {
          id: newId,
          name: cleanName,
          slug: generatedSlug,
          description: description || '',
          icon: icon || 'fa-solid fa-shapes',
          sort_order: ordVal,
          show_on_home: isHome,
          is_active: activeVal,
          image_url: imageUrl,
          design_count: 0
        }
      });
    }

    req.flash('success', `Category "${cleanName}" added successfully.`);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(`[Category Create Error ${refId}]:`, err);
    let userMsg = err.message || 'Failed to create category.';
    if (err.message && err.message.toLowerCase().includes('upload') && err.message.toLowerCase().includes('block')) {
      userMsg = 'Uploads blocked: Set UPLOAD_DIR=/home/u101925264/aruvi-uploads in hPanel -> Node.js app -> Environment variables and restart.';
    }

    if (isAjax) {
      return res.status(500).json({ success: false, refId, message: `${userMsg} (Ref: #${refId})` });
    }
    req.flash('error', `${userMsg} (Ref: #${refId})`);
    res.redirect('/admin/categories');
  }
};

exports.postUpdate = async (req, res, next) => {
  const refId = makeRefId();
  const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));

  try {
    const { id } = req.params;
    const { name, slug, description, icon, display_order, sort_order, show_on_home, is_active, remove_image } = req.body;
    const errors = {};

    if (!name || !name.trim()) {
      errors.name = 'Category name is required.';
    }

    const cleanName = (name || '').trim();
    const generatedSlug = slug && slug.trim() 
      ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') 
      : cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    if (!generatedSlug) {
      errors.slug = 'Valid slug is required.';
    } else {
      const isTaken = await Category.isSlugTaken(generatedSlug, id);
      if (isTaken) {
        errors.slug = `The slug "${generatedSlug}" is already taken by another category.`;
      }
    }

    // Validate real image content
    if (req.file) {
      const imgCheck = await validateImageFile(req.file);
      if (!imgCheck.valid) {
        errors.image = imgCheck.message;
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
    }

    if (Object.keys(errors).length > 0) {
      if (isAjax) {
        return res.status(422).json({ success: false, refId, message: 'Please correct the highlighted errors.', errors });
      }
      req.flash('error', Object.values(errors).join(' '));
      return res.redirect('/admin/categories');
    }

    let imageUrl = undefined; // undefined preserves existing image
    let newUploadedUrl = null;

    if (remove_image === '1' || remove_image === 'on' || remove_image === true) {
      imageUrl = '__REMOVE__';
    } else if (req.file) {
      newUploadedUrl = await storage.savePublicFile(req.file.path, req.file.originalname, req.file.mimetype, 'categories');
      imageUrl = newUploadedUrl;
      try {
        if (req.file.path && fs.existsSync(req.file.path) && req.file.path !== imageUrl) {
          fs.unlinkSync(req.file.path);
        }
      } catch (_) {}
    }

    const isHome = (show_on_home === '1' || show_on_home === 'on' || show_on_home === true || show_on_home === 1) ? 1 : 0;
    const activeVal = (is_active !== undefined) ? ((is_active === '1' || is_active === 'on' || is_active === true || is_active === 1) ? 1 : 0) : undefined;
    const ordVal = parseInt(sort_order !== undefined ? sort_order : display_order, 10) || 0;

    const updateResult = await Category.update(id, {
      name: cleanName,
      slug: generatedSlug,
      description: description ? description.trim() : null,
      image_url: imageUrl,
      card_image_key: imageUrl,
      icon: icon || 'fa-solid fa-shapes',
      sort_order: ordVal,
      display_order: ordVal,
      show_on_home: isHome,
      is_active: activeVal
    });

    // Retire old image only AFTER DB commit
    if (updateResult && updateResult.oldImageToRetire) {
      storage.retireFile(updateResult.oldImageToRetire);
    }

    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'update', 'category', id, `Updated category: "${cleanName}"`);

    const updatedCategory = await Category.getById(id);
    const designCount = await Category.getDesignCount(id);

    if (isAjax) {
      return res.json({
        success: true,
        message: `Category "${cleanName}" updated successfully.`,
        category: {
          id: parseInt(id, 10),
          name: cleanName,
          slug: generatedSlug,
          description: description || '',
          icon: icon || (updatedCategory ? updatedCategory.icon : 'fa-solid fa-shapes'),
          sort_order: ordVal,
          show_on_home: isHome,
          is_active: (activeVal !== undefined ? activeVal : (updatedCategory ? updatedCategory.is_active : 1)),
          image_url: updatedCategory ? (updatedCategory.card_image_key || updatedCategory.image_url) : null,
          design_count: designCount
        }
      });
    }

    req.flash('success', `Category "${cleanName}" updated successfully.`);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(`[Category Update Error ${refId}]:`, err);
    let userMsg = err.message || 'Failed to update category.';
    if (err.message && err.message.toLowerCase().includes('upload') && err.message.toLowerCase().includes('block')) {
      userMsg = 'Uploads blocked: Set UPLOAD_DIR=/home/u101925264/aruvi-uploads in hPanel -> Node.js app -> Environment variables and restart.';
    }

    if (isAjax) {
      return res.status(500).json({ success: false, refId, message: `${userMsg} (Ref: #${refId})` });
    }
    req.flash('error', `${userMsg} (Ref: #${refId})`);
    res.redirect('/admin/categories');
  }
};

exports.toggleStatus = async (req, res, next) => {
  const refId = makeRefId();
  try {
    const { id } = req.params;
    const newStatus = await Category.toggleStatus(id);
    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'update_status', 'category', id, `Toggled category status to ${newStatus ? 'Active' : 'Inactive'}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, is_active: newStatus, message: `Category is now ${newStatus ? 'Active' : 'Inactive'}.` });
    }
    req.flash('success', `Category status updated.`);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(`[Toggle Status Error ${refId}]:`, err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, refId, message: `Failed to update status. (Ref: #${refId})` });
    }
    next(err);
  }
};

exports.toggleHome = async (req, res, next) => {
  const refId = makeRefId();
  try {
    const { id } = req.params;
    const newHome = await Category.toggleHome(id);
    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'update_category', 'category', id, `Toggled category show_on_home to ${newHome ? 'Home' : 'Hidden'}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, show_on_home: newHome, message: `Category is now ${newHome ? 'Shown on Home' : 'Hidden from Home'}.` });
    }
    req.flash('success', 'Category updated.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(`[Toggle Home Error ${refId}]:`, err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, refId, message: `Failed to update home display. (Ref: #${refId})` });
    }
    next(err);
  }
};

exports.postReorder = async (req, res, next) => {
  const refId = makeRefId();
  try {
    const { id, direction } = req.params;
    const success = await Category.reorder(id, direction);
    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'reorder', 'category', id, `Reordered category #${id} ${direction}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success, message: `Category moved ${direction}.` });
    }
    req.flash('success', `Category order updated.`);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(`[Reorder Error ${refId}]:`, err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, refId, message: `Failed to reorder category. (Ref: #${refId})` });
    }
    next(err);
  }
};

exports.deleteCategory = async (req, res, next) => {
  const refId = makeRefId();
  const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

  try {
    const { id } = req.params;
    const { reassign_to } = req.body || {};
    const cat = await Category.getById(id);

    if (!cat) {
      if (isAjax) {
        return res.status(404).json({ success: false, message: 'Category not found.' });
      }
      req.flash('error', 'Category not found.');
      return res.redirect('/admin/categories');
    }

    // Check design count
    const designCount = await Category.getDesignCount(id);

    if (designCount > 0) {
      // If reassign target is not provided, block deletion with designs warning
      if (!reassign_to) {
        return res.status(400).json({
          success: false,
          has_designs: true,
          count: designCount,
          category_name: cat.name,
          message: `Category "${cat.name}" contains ${designCount} design(s). Reassign them to another category first.`
        });
      }

      // Reassign designs
      const reassignedCount = await Category.reassignDesigns(id, reassign_to);
      await ActivityLog.logFromReq(req, 'reassign', 'designs', id, `Reassigned ${reassignedCount} designs from category #${id} to #${reassign_to}`);
    }

    await Category.delete(id);
    if (cat.image_url) {
      storage.retireFile(cat.image_url);
    }
    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'delete', 'category', id, `Deleted category: "${cat.name}"`);

    const msg = designCount > 0 
      ? `Reassigned ${designCount} designs and deleted category "${cat.name}".`
      : `Category "${cat.name}" deleted successfully.`;

    if (isAjax) {
      return res.json({ success: true, message: msg });
    }

    req.flash('success', msg);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(`[Delete Category Error ${refId}]:`, err);
    if (isAjax) {
      return res.status(500).json({ success: false, refId, message: `${err.message || 'Unable to delete category.'} (Ref: #${refId})` });
    }
    req.flash('error', `Unable to delete category: ${err.message} (Ref: #${refId})`);
    res.redirect('/admin/categories');
  }
};

exports.postBulkAction = async (req, res, next) => {
  const refId = makeRefId();
  try {
    const { action, ids } = req.body;
    if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No categories selected.' });
    }

    let affected = 0;
    if (action === 'activate') {
      for (const catId of ids) {
        await Category.update(catId, { is_active: 1 });
        affected++;
      }
    } else if (action === 'deactivate') {
      for (const catId of ids) {
        await Category.update(catId, { is_active: 0 });
        affected++;
      }
    } else if (action === 'delete') {
      for (const catId of ids) {
        const cnt = await Category.getDesignCount(catId);
        if (cnt === 0) {
          await Category.delete(catId);
          affected++;
        }
      }
    }

    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'bulk_action', 'categories', null, `Bulk ${action} on ${affected} categories`);

    res.json({ success: true, message: `Successfully updated ${affected} categories.` });
  } catch (err) {
    console.error(`[Bulk Category Action Error ${refId}]:`, err);
    res.status(500).json({ success: false, refId, message: `Failed to process bulk action. (Ref: #${refId})` });
  }
};
