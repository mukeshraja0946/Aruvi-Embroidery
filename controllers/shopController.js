const Design = require('../models/Design');
const Category = require('../models/Category');
const Review = require('../models/Review');
const Wishlist = require('../models/Wishlist');
const Order = require('../models/Order');

exports.getShopPage = async (req, res, next) => {
  try {
    const { search, category, format, min_price, max_price, min_rating, sort, page } = req.query;
    const currentPage = parseInt(page) || 1;
    const limit = 12;

    let selectedCategory = null;
    let categoryId = null;

    if (category) {
      selectedCategory = await Category.getBySlug(category);
      if (selectedCategory) categoryId = selectedCategory.id;
    }

    const { designs, total, totalPages } = await Design.getAll({
      search,
      category_id: categoryId,
      category_slug: category,
      format,
      min_price,
      max_price,
      min_rating,
      sort,
      page: currentPage,
      limit
    });

    const categories = await Category.getAll();
    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];

    res.render('shop/index', {
      title: selectedCategory ? `${selectedCategory.name} - ARUVI EMBROIDERY STUDIO` : 'All Embroidery Designs - ARUVI EMBROIDERY STUDIO',
      designs,
      categories,
      userPurchasedDesignIds,
      selectedCategory,
      search: search || '',
      selectedFormat: format || '',
      min_price: min_price || '',
      max_price: max_price || '',
      min_rating: min_rating || '',
      sort: sort || 'newest',
      currentPage,
      totalPages,
      total
    });
  } catch (err) {
    next(err);
  }
};

exports.getCategoriesPage = async (req, res, next) => {
  try {
    const categories = await Category.getAll();
    const featuredDesigns = await Design.getFeatured(6);
    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];
    res.render('shop/categories', {
      title: 'Categories - ARUVI EMBROIDERY STUDIO',
      categories,
      featuredDesigns,
      userPurchasedDesignIds
    });
  } catch (err) {
    next(err);
  }
};

exports.getCategoryDetailPage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { sort, sub, page, search } = req.query;
    const category = await Category.getBySlug(id) || await Category.getById(id);

    if (!category) {
      req.flash('error', 'Category not found.');
      return res.redirect('/categories');
    }

    const currentPage = parseInt(page) || 1;
    const limit = 16;

    const { designs, total, totalPages } = await Design.getAll({
      category_id: category.id,
      search: sub ? sub : (search || ''),
      sort: sort || 'latest',
      page: currentPage,
      limit
    });

    const categories = await Category.getAll();
    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];

    res.render('shop/category-detail', {
      title: `${category.name} - ARUVI EMBROIDERY STUDIO`,
      category,
      designs,
      categories,
      userPurchasedDesignIds,
      total,
      currentPage,
      totalPages,
      currentSort: sort || 'latest',
      currentSub: sub || '',
      search: search || ''
    });
  } catch (err) {
    next(err);
  }
};

exports.getDesignDetail = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const design = await Design.getBySlug(slug);

    if (!design) {
      req.flash('error', 'Design not found.');
      return res.redirect('/designs');
    }

    const relatedDesigns = await Design.getRelated(design.category_id, design.id, 4);
    const reviews = await Review.getByDesignId(design.id);
    const inWishlist = req.user ? await Wishlist.isInWishlist(req.user.id, design.id) : false;
    const hasPurchased = req.user ? await Order.hasUserPurchasedDesign(req.user.id, design.id) : false;
    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];

    res.render('shop/detail', {
      title: `${design.title} - Digital Embroidery Design | ARUVI EMBROIDERY STUDIO`,
      design,
      relatedDesigns,
      reviews,
      inWishlist,
      hasPurchased,
      userPurchasedDesignIds
    });
  } catch (err) {
    next(err);
  }
};

exports.postReview = async (req, res, next) => {
  try {
    const { design_id, rating, comment } = req.body;
    if (!req.user) {
      req.flash('error', 'Please log in to submit a review.');
      return res.redirect('back');
    }

    await Review.addReview({
      design_id,
      user_id: req.user.id,
      rating: parseInt(rating),
      comment
    });

    req.flash('success', 'Thank you! Your review has been published.');
    res.redirect('back');
  } catch (err) {
    next(err);
  }
};

exports.getDesignApi = async (req, res, next) => {
  try {
    const { id } = req.params;
    const design = await Design.getById(id) || await Design.getBySlug(id);

    if (!design) {
      return res.status(404).json({ success: false, message: 'Design not found' });
    }

    const files = (design.files || []).map(f => ({
      id: f.id,
      name: f.file_name,
      type: (f.file_format || '').toUpperCase(),
      size: f.file_size,
      path: f.file_path,
      isPreview: Boolean(f.is_preview || ['PNG','JPG','JPEG','WEBP'].includes((f.file_format || '').toUpperCase()))
    }));

    const category = design.category_id ? {
      id: design.category_id,
      name: design.category_name,
      slug: design.category_slug
    } : null;

    const originalPrice = parseFloat(design.price || 0);
    const discountPrice = design.sale_price !== null && design.sale_price !== undefined ? parseFloat(design.sale_price) : originalPrice;
    const discountPercentage = (originalPrice > 0 && originalPrice > discountPrice) ? Math.round(((originalPrice - discountPrice) / originalPrice) * 100) : 0;

    return res.json({
      id: design.id,
      name: design.title,
      sku: design.sku,
      category,
      originalPrice,
      discountPrice,
      discountPercentage,
      status: design.is_active ? 'active' : 'inactive',
      featured: Boolean(design.is_featured),
      trending: Boolean(design.is_trending),
      files,
      previewImage: design.primary_image
    });
  } catch (err) {
    next(err);
  }
};
