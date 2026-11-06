const Category = require('../../models/Category');
const ActivityLog = require('../../models/ActivityLog');
const Setting = require('../../models/Setting');

function invalidateCategoryCaches(req) {
  if (req.app && req.app.locals) {
    if (req.app.locals.siteSettings) {
      // Keep siteSettings up to date
    }
  }
}

exports.getCategories = async (req, res, next) => {
  try {
    const { sort, search, status } = req.query;
    const categories = await Category.getAll({ sort: sort || 'newest', search, status });
    const countDisplay = await Setting.get('category_count_display', 'exact');
    const hideEmpty = await Setting.get('category_hide_empty', '0');

    res.render('admin/categories/index', {
      title: 'Manage Categories - Admin',
      categories: categories || [],
      currentSort: sort || 'newest',
      currentSearch: search || '',
      currentStatus: status || '',
      countDisplay,
      hideEmpty
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

    // Invalidate siteSettings app cache immediately
    if (req.app && req.app.locals && req.app.locals.siteSettings) {
      req.app.locals.siteSettings.category_count_display = countDisplay;
      req.app.locals.siteSettings.category_hide_empty = hideEmpty;
    }
    invalidateCategoryCaches(req);

    req.flash('success', 'Category display settings updated successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.postCreate = async (req, res, next) => {
  try {
    const { name, slug, description, icon, display_order, sort_order, show_on_home, is_active } = req.body;
    const generatedSlug = slug ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const storage = require('../../config/storage');
    let imageUrl = null;
    if (req.file) {
      imageUrl = await storage.savePublicFile(req.file.path, req.file.originalname, req.file.mimetype);
    }

    const isHome = (show_on_home === undefined || show_on_home === '1' || show_on_home === 'on' || show_on_home === true || show_on_home === 1) ? 1 : 0;
    const activeVal = (is_active === undefined || is_active === '1' || is_active === 'on' || is_active === true || is_active === 1) ? 1 : 0;
    const ordVal = parseInt(sort_order !== undefined ? sort_order : display_order, 10) || 0;

    const newId = await Category.create({
      name,
      slug: generatedSlug,
      description,
      image_url: imageUrl,
      card_image_key: imageUrl,
      icon: icon || 'fa-solid fa-shapes',
      sort_order: ordVal,
      display_order: ordVal,
      show_on_home: isHome,
      is_active: activeVal
    });

    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'create', 'category', newId, `Created category: "${name}"`);
    req.flash('success', `Category "${name}" added successfully.`);
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.postUpdate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, icon, display_order, sort_order, show_on_home, is_active, remove_image } = req.body;
    const generatedSlug = slug ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let imageUrl = null;
    if (remove_image === '1') {
      imageUrl = '';
    } else if (req.file) {
      const storage = require('../../config/storage');
      imageUrl = await storage.savePublicFile(req.file.path, req.file.originalname, req.file.mimetype);
    }

    const isHome = (show_on_home === '1' || show_on_home === 'on' || show_on_home === true || show_on_home === 1) ? 1 : 0;
    const activeVal = (is_active !== undefined) ? ((is_active === '1' || is_active === 'on' || is_active === true || is_active === 1) ? 1 : 0) : undefined;
    const ordVal = parseInt(sort_order !== undefined ? sort_order : display_order, 10) || 0;

    await Category.update(id, {
      name,
      slug: generatedSlug,
      description,
      image_url: imageUrl,
      card_image_key: imageUrl,
      icon: icon || 'fa-solid fa-shapes',
      sort_order: ordVal,
      display_order: ordVal,
      show_on_home: isHome,
      is_active: activeVal
    });

    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'update', 'category', id, `Updated category: "${name}"`);
    req.flash('success', `Category updated.`);
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.toggleStatus = async (req, res, next) => {
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
    next(err);
  }
};

exports.toggleHome = async (req, res, next) => {
  try {
    const { id } = req.params;
    const cat = await Category.getById(id);
    if (!cat) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
      return res.redirect('/admin/categories');
    }
    const currentHome = (cat.show_on_home !== 0 && cat.show_on_home !== false && cat.show_on_home !== '0');
    const newHome = currentHome ? 0 : 1;

    await Category.update(id, {
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      icon: cat.icon,
      sort_order: cat.sort_order || cat.display_order || 0,
      display_order: cat.sort_order || cat.display_order || 0,
      show_on_home: newHome
    });

    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'update_category', 'category', id, `Toggled category show_on_home to ${newHome ? 'Home' : 'Hidden'}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, show_on_home: newHome, message: `Category is now ${newHome ? 'Shown on Home' : 'Hidden from Home'}.` });
    }
    req.flash('success', 'Category updated.');
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.postReorder = async (req, res, next) => {
  try {
    const { id, direction } = req.params;
    await Category.reorder(id, direction);
    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'reorder', 'category', id, `Reordered category #${id} ${direction}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, message: `Category moved ${direction}.` });
    }
    req.flash('success', `Category order updated.`);
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const cat = await Category.getById(id);
    await Category.delete(id);
    invalidateCategoryCaches(req);
    await ActivityLog.logFromReq(req, 'delete', 'category', id, `Deleted category: "${cat ? cat.name : id}"`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'Category deleted successfully.' });
    }

    req.flash('success', 'Category deleted successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Delete category error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete category. Please try again.' });
    }
    req.flash('error', `Unable to delete category: ${err.message}`);
    res.redirect('/admin/categories');
  }
};
