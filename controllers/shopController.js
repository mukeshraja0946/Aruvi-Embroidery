const Design = require('../models/Design');
const Category = require('../models/Category');
const Review = require('../models/Review');
const Wishlist = require('../models/Wishlist');
const Order = require('../models/Order');
const Setting = require('../models/Setting');
const db = require('../config/db');

exports.getShopPage = async (req, res, next) => {
  try {
    const { search, category, format, min_price, max_price, min_rating, sort, page } = req.query;
    const currentPage = parseInt(page) || 1;
    const limit = parseInt(req.query.limit) || 24;

    let selectedCategory = null;
    let categoryId = null;

    if (category) {
      selectedCategory = await Category.getBySlug(category);
      if (selectedCategory) categoryId = selectedCategory.id;
    }

    const normalizedSort = (sort === 'newest') ? 'latest' : (sort || 'latest');

    const { designs, total, totalPages } = await Design.getAll({
      search,
      category_id: categoryId,
      category_slug: category,
      format,
      min_price,
      max_price,
      min_rating,
      sort: normalizedSort,
      page: currentPage,
      limit
    });

    const categories = await Category.getAll({ status: 'active' });
    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];
    const userWishlist = req.user ? await Wishlist.getByUser(req.user.id) : [];
    const userWishlistDesignIds = (userWishlist || []).map(w => w.id || w.wishlist_id);

    // Real live total active designs count across entire DB
    let totalActiveDesigns = 0;
    if (db.isConnected()) {
      try {
        const countRes = await db.query('SELECT COUNT(*) as cnt FROM designs WHERE is_active = 1');
        if (countRes && countRes[0]) {
          totalActiveDesigns = parseInt(countRes[0].cnt || 0, 10);
        }
      } catch (e) {
        totalActiveDesigns = total;
      }
    } else {
      totalActiveDesigns = total;
    }

    const hideEmptySetting = await Setting.get('hide_empty_categories_in_pills', '1');
    const hideEmptyCategories = hideEmptySetting !== 'false' && hideEmptySetting !== '0';

    if (req.query.ajax === '1' || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({
        success: true,
        designs,
        total,
        totalPages,
        currentPage,
        hasMore: currentPage < totalPages,
        userPurchasedDesignIds,
        userWishlistDesignIds
      });
    }

    res.render('shop/index', {
      title: selectedCategory ? `${selectedCategory.name} - ARUVI EMBROIDERY STUDIO` : 'All Embroidery Designs - ARUVI EMBROIDERY STUDIO',
      designs,
      categories,
      totalActiveDesigns,
      hideEmptyCategories,
      userPurchasedDesignIds,
      userWishlistDesignIds,
      selectedCategory,
      search: search || '',
      selectedFormat: format || '',
      min_price: min_price || '',
      max_price: max_price || '',
      min_rating: min_rating || '',
      sort: normalizedSort,
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
    const userWishlist = req.user ? await Wishlist.getByUser(req.user.id) : [];
    const userWishlistDesignIds = (userWishlist || []).map(w => w.id || w.wishlist_id);
    res.render('shop/categories', {
      title: 'Categories - ARUVI EMBROIDERY STUDIO',
      categories,
      featuredDesigns,
      userPurchasedDesignIds,
      userWishlistDesignIds
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
    const limit = parseInt(req.query.limit) || 24;

    const { designs, total, totalPages } = await Design.getAll({
      category_id: category.id,
      search: sub ? sub : (search || ''),
      sort: sort || 'latest',
      page: currentPage,
      limit
    });

    const categories = await Category.getAll({ status: 'active' });
    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];
    const userWishlist = req.user ? await Wishlist.getByUser(req.user.id) : [];
    const userWishlistDesignIds = (userWishlist || []).map(w => w.id || w.wishlist_id);

    let totalActiveDesigns = 0;
    if (db.isConnected()) {
      try {
        const countRes = await db.query('SELECT COUNT(*) as cnt FROM designs WHERE is_active = 1');
        if (countRes && countRes[0]) {
          totalActiveDesigns = parseInt(countRes[0].cnt || 0, 10);
        }
      } catch (e) {
        totalActiveDesigns = total;
      }
    } else {
      totalActiveDesigns = total;
    }

    const hideEmptySetting = await Setting.get('hide_empty_categories_in_pills', '1');
    const hideEmptyCategories = hideEmptySetting !== 'false' && hideEmptySetting !== '0';

    if (req.query.ajax === '1' || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({
        success: true,
        designs,
        total,
        totalPages,
        currentPage,
        hasMore: currentPage < totalPages,
        userPurchasedDesignIds,
        userWishlistDesignIds
      });
    }

    res.render('shop/category-detail', {
      title: `${category.name} - ARUVI EMBROIDERY STUDIO`,
      category,
      designs,
      categories,
      totalActiveDesigns,
      hideEmptyCategories,
      userPurchasedDesignIds,
      userWishlistDesignIds,
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

exports.getSearchSuggestions = async (req, res, next) => {
  try {
    const q = (req.query.q || req.query.search || '').trim();
    if (!q) {
      return res.json({ success: true, suggestions: [] });
    }
    const suggestions = await Design.getSuggestions(q, 8);
    return res.json({ success: true, suggestions });
  } catch (err) {
    console.error('getSearchSuggestions error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getDesignsCount = async (req, res, next) => {
  try {
    const { search, category, format, min_price, max_price, min_rating } = req.query;
    let categoryId = null;
    if (category) {
      const cat = await Category.getBySlug(category);
      if (cat) categoryId = cat.id;
    }
    const { total } = await Design.getAll({
      search,
      category_id: categoryId,
      category_slug: category,
      format,
      min_price,
      max_price,
      min_rating,
      page: 1,
      limit: 1
    });
    return res.json({ success: true, count: total });
  } catch (err) {
    console.error('getDesignsCount error:', err);
    return res.json({ success: false, count: 0 });
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

    const parseNum = (val) => {
      if (val === null || val === undefined) return null;
      const clean = String(val).replace(/,/g, '').trim();
      if (clean === '') return null;
      const n = parseInt(clean, 10);
      return (!isNaN(n) && n >= 0) ? n : null;
    };

    const frontStitches = parseNum(design.stitch_count_front);
    const backStitches = parseNum(design.stitch_count_back);
    const sleeveStitches = parseNum(design.stitch_count_sleeve);

    const allComponentsValid = frontStitches !== null && backStitches !== null && sleeveStitches !== null;
    const anyComponentValid = frontStitches !== null || backStitches !== null || sleeveStitches !== null;

    let calculatedTotal = null;
    let stitchStatus = 'not_available';

    if (allComponentsValid) {
      calculatedTotal = frontStitches + backStitches + sleeveStitches;
      stitchStatus = 'complete';
    } else if (anyComponentValid) {
      stitchStatus = 'incomplete';
    } else if (design.stitch_count !== null && design.stitch_count !== undefined) {
      const legacyTotal = parseNum(design.stitch_count);
      if (legacyTotal !== null) {
        calculatedTotal = legacyTotal;
        stitchStatus = 'complete';
      }
    }

    return res.json({
      id: design.id,
      name: design.title,
      title: design.title,
      sku: design.sku,
      category,
      originalPrice,
      discountPrice,
      discountPercentage,
      status: design.is_active ? 'active' : 'inactive',
      featured: Boolean(design.is_featured),
      trending: Boolean(design.is_trending),
      stitch_count: calculatedTotal,
      stitch_count_front: frontStitches,
      stitch_count_back: backStitches,
      stitch_count_sleeve: sleeveStitches,
      stitchCount: calculatedTotal,
      stitchCountFront: frontStitches,
      stitchCountBack: backStitches,
      stitchCountSleeve: sleeveStitches,
      stitchCountStatus: stitchStatus,
      description: design.description || null,
      dimensions: design.dimensions || design.hoop_size || null,
      hoop_size: design.hoop_size || null,
      formats: design.formats || null,
      files,
      previewImage: design.primary_image
    });
  } catch (err) {
    next(err);
  }
};
