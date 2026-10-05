const Category = require('../../models/Category');

exports.getCategories = async (req, res, next) => {
  try {
    const categories = await Category.getAll();
    res.render('admin/categories/index', {
      title: 'Manage Categories - Admin',
      categories
    });
  } catch (err) {
    next(err);
  }
};

exports.postCreate = async (req, res, next) => {
  try {
    const { name, slug, description, display_order } = req.body;
    const generatedSlug = slug ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let imageUrl = '/public/images/logo.jpg';
    if (req.file) {
      imageUrl = `/public/uploads/previews/${req.file.filename}`;
    }

    await Category.create({
      name,
      slug: generatedSlug,
      description,
      image_url: imageUrl,
      display_order: parseInt(display_order) || 0
    });

    req.flash('success', `Category "${name}" added successfully.`);
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.postUpdate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, display_order } = req.body;
    const generatedSlug = slug ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let imageUrl = null;
    if (req.file) {
      imageUrl = `/public/uploads/previews/${req.file.filename}`;
    }

    await Category.update(id, {
      name,
      slug: generatedSlug,
      description,
      image_url: imageUrl,
      display_order: parseInt(display_order) || 0
    });

    req.flash('success', `Category updated.`);
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Category.delete(id);
    req.flash('info', 'Category deleted.');
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
};
