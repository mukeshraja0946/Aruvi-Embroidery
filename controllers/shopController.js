const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Design = require('../models/Design');
const Category = require('../models/Category');
const Review = require('../models/Review');
const Wishlist = require('../models/Wishlist');
const Order = require('../models/Order');
const Setting = require('../models/Setting');
const db = require('../config/db');
const watermarkService = require('../services/watermarkService');

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

    const frontStitches = parseNum(design.stitch_count_front !== undefined ? design.stitch_count_front : design.frontStitchCount);
    const backStitches = parseNum(design.stitch_count_back !== undefined ? design.stitch_count_back : design.backStitchCount);
    const sleeveStitches = parseNum(design.stitch_count_sleeve !== undefined ? design.stitch_count_sleeve : design.sleeveStitchCount);

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
    } else if (design.totalStitchCount !== null && design.totalStitchCount !== undefined) {
      const legacyTotal = parseNum(design.totalStitchCount);
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
      frontStitchCount: frontStitches,
      backStitchCount: backStitches,
      sleeveStitchCount: sleeveStitches,
      totalStitchCount: calculatedTotal,
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

/**
 * Download Customer Design Preview as a real PNG image
 * Converts JPG / WebP to authentic PNG via sharp or serves original PNG directly.
 * Filename format: <sku>.png or <title>.png
 */
exports.downloadPreviewPng = async (req, res, next) => {
  try {
    const designId = req.params.id;
    const design = await Design.getById(designId) || await Design.getBySlug(designId);
    if (!design) {
      return res.status(404).json({ success: false, message: 'Design not found' });
    }

    const reqImgUrl = req.query.imgUrl || design.primary_image || '/public/images/cat_floral.jpg';
    if (!reqImgUrl) {
      return res.status(404).json({ success: false, message: 'No preview image available for this design' });
    }

    // Security check: strictly forbid machine embroidery files, archives, and system files
    const forbiddenExts = ['.zip', '.dst', '.pes', '.jef', '.exp', '.xxx', '.vp3', '.hus', '.env', '.json', '.sql', '.js', '.rar', '.7z'];
    const lowerUrl = reqImgUrl.toLowerCase().split('?')[0];
    if (forbiddenExts.some(ext => lowerUrl.endsWith(ext))) {
      return res.status(403).json({ success: false, message: 'Machine files cannot be downloaded via preview download' });
    }
    if (reqImgUrl.includes('..') || reqImgUrl.includes('etc/passwd') || reqImgUrl.includes('.env')) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Increment preview_download_count safely
    if (db.isConnected()) {
      try {
        await db.query('UPDATE designs SET preview_download_count = COALESCE(preview_download_count, 0) + 1 WHERE id = ?', [design.id]);
      } catch (cntErr) {
        console.warn('[Preview Download Count Error]:', cntErr.message);
      }
    }

    let inputBuffer = null;

    // First attempt local file lookup (handles both relative paths and full URLs pointing to this host)
    let localRel = reqImgUrl;
    if (reqImgUrl.startsWith('http://') || reqImgUrl.startsWith('https://')) {
      try {
        const parsedUrl = new URL(reqImgUrl);
        localRel = parsedUrl.pathname;
      } catch (e) {
        localRel = reqImgUrl;
      }
    }

    const cleanRel = localRel.split('?')[0].replace(/^\//, '');
    const candidates = [
      path.resolve(__dirname, '..', cleanRel),
      path.resolve(__dirname, '..', 'public', cleanRel.replace(/^public\//, '')),
      path.resolve(__dirname, '..', 'public', 'uploads', cleanRel.replace(/^(public\/)?uploads\//, '')),
      path.resolve(__dirname, '..', 'public', 'uploads', 'previews', cleanRel.replace(/^(public\/)?(uploads\/)?previews\//, '')),
      path.resolve(__dirname, '..', 'public', 'images', cleanRel.replace(/^(public\/)?images\//, ''))
    ];

    let foundPath = null;
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        foundPath = cand;
        break;
      }
    }

    if (foundPath) {
      inputBuffer = await fs.promises.readFile(foundPath);
    } else if (reqImgUrl.startsWith('http://') || reqImgUrl.startsWith('https://')) {
      try {
        const fetchRes = await fetch(reqImgUrl);
        if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
        const arrayBuf = await fetchRes.arrayBuffer();
        inputBuffer = Buffer.from(arrayBuf);
      } catch (netErr) {
        return res.status(502).json({ success: false, message: 'Failed to fetch remote preview image: ' + netErr.message });
      }
    } else {
      return res.status(404).json({ success: false, message: 'Preview image file not found on server' });
    }

    if (!inputBuffer || inputBuffer.length === 0) {
      return res.status(500).json({ success: false, message: 'Preview image file is empty' });
    }

    // Check if input is already a valid PNG (magic bytes: 89 50 4E 47 0D 0A 1A 0A)
    const isPng = inputBuffer.length > 8 &&
                  inputBuffer[0] === 0x89 &&
                  inputBuffer[1] === 0x50 &&
                  inputBuffer[2] === 0x4E &&
                  inputBuffer[3] === 0x47;

    let outputPngBuffer;
    if (isPng) {
      outputPngBuffer = inputBuffer;
    } else {
      outputPngBuffer = await sharp(inputBuffer)
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
    }

    const rawSku = (design.sku || '').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const rawTitle = (design.title || '').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const baseClean = (rawSku || rawTitle || 'design').replace(/\.[a-zA-Z0-9]+$/, '') || 'design';
    const downloadFilename = `${baseClean}-preview.png`;

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`);
    res.setHeader('Content-Length', outputPngBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(outputPngBuffer);
  } catch (err) {
    console.error('[Download Preview PNG Error]:', err);
    return res.status(500).json({ success: false, message: 'Error processing preview image: ' + err.message });
  }
};

/**
 * Dedicated Preview Download Route matching Task 3 requirements:
 * /designs/:slug/preview-download/:imageId?
 * Supports on-the-fly watermarking, login permissions, separate preview download tracking,
 * and strictly prevents machine file downloads.
 */
exports.downloadPreviewImageRoute = async (req, res, next) => {
  try {
    const slugOrId = req.params.slug || req.params.id;
    const design = await Design.getBySlug(slugOrId) || await Design.getById(slugOrId);
    if (!design) {
      return res.status(404).json({ success: false, message: 'Design not found' });
    }

    const settings = await Setting.getAll();
    if (settings.show_preview_download_button === '0') {
      return res.status(403).json({ success: false, message: 'Preview downloads are disabled by administrator.' });
    }

    if (settings.require_login_preview_download === '1' && !req.user) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(401).json({ success: false, requireLogin: true, message: 'Please log in to download this preview image.' });
      }
      return res.redirect(`/user/login?returnUrl=${encodeURIComponent(req.originalUrl)}`);
    }

    let reqImgUrl = null;
    const imageId = req.params.imageId;
    if (imageId) {
      if (db.isConnected()) {
        const [imgRow] = await db.query('SELECT image_url FROM design_images WHERE id = ? AND design_id = ?', [imageId, design.id]);
        if (imgRow) reqImgUrl = imgRow.image_url;
      } else if (design.images && design.images.length > 0) {
        const found = design.images.find(im => im.id == imageId);
        if (found) reqImgUrl = found.image_url;
      }
    }

    if (!reqImgUrl) {
      reqImgUrl = req.query.imgUrl || design.primary_image || '/public/images/cat_floral.jpg';
    }

    // Security check: strictly forbid machine embroidery files, archives, and system files
    const forbiddenExts = ['.zip', '.dst', '.pes', '.jef', '.exp', '.xxx', '.vp3', '.hus', '.env', '.json', '.sql', '.js', '.rar', '.7z'];
    const lowerUrl = reqImgUrl.toLowerCase().split('?')[0];
    if (forbiddenExts.some(ext => lowerUrl.endsWith(ext))) {
      return res.status(403).json({ success: false, message: 'Machine files cannot be downloaded via preview download' });
    }
    if (reqImgUrl.includes('..') || reqImgUrl.includes('etc/passwd') || reqImgUrl.includes('.env')) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Increment preview_download_count safely (separated from real purchase downloads)
    if (db.isConnected()) {
      try {
        await db.query('UPDATE designs SET preview_download_count = COALESCE(preview_download_count, 0) + 1 WHERE id = ?', [design.id]);
      } catch (cntErr) {
        console.warn('[Preview Download Count Error]:', cntErr.message);
      }
    }

    let inputBuffer = null;
    let localRel = reqImgUrl;
    if (reqImgUrl.startsWith('http://') || reqImgUrl.startsWith('https://')) {
      try {
        const parsedUrl = new URL(reqImgUrl);
        localRel = parsedUrl.pathname;
      } catch {
        localRel = reqImgUrl;
      }
    }

    const cleanRel = localRel.split('?')[0].replace(/^\//, '');
    const candidates = [
      path.resolve(__dirname, '..', cleanRel),
      path.resolve(__dirname, '..', 'public', cleanRel.replace(/^public\//, '')),
      path.resolve(__dirname, '..', 'public', 'uploads', cleanRel.replace(/^(public\/)?uploads\//, '')),
      path.resolve(__dirname, '..', 'public', 'uploads', 'previews', cleanRel.replace(/^(public\/)?(uploads\/)?previews\//, '')),
      path.resolve(__dirname, '..', 'public', 'images', cleanRel.replace(/^(public\/)?images\//, ''))
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        inputBuffer = await fs.promises.readFile(cand);
        break;
      }
    }

    if (!inputBuffer && (reqImgUrl.startsWith('http://') || reqImgUrl.startsWith('https://'))) {
      try {
        const fetchRes = await fetch(reqImgUrl);
        if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
        inputBuffer = Buffer.from(await fetchRes.arrayBuffer());
      } catch (netErr) {
        return res.status(502).json({ success: false, message: 'Failed to fetch remote preview image: ' + netErr.message });
      }
    }

    if (!inputBuffer || inputBuffer.length === 0) {
      return res.status(404).json({ success: false, message: 'Preview image file not found on server' });
    }

    // Apply watermark if enabled (default ON)
    let outputBuffer = inputBuffer;
    if (settings.watermark_preview_images !== '0') {
      outputBuffer = await watermarkService.applyWatermark(inputBuffer, { format: 'png' });
    } else {
      const isPng = inputBuffer.length > 8 &&
                    inputBuffer[0] === 0x89 && inputBuffer[1] === 0x50 &&
                    inputBuffer[2] === 0x4E && inputBuffer[3] === 0x47;
      if (!isPng) {
        outputBuffer = await sharp(inputBuffer).png({ compressionLevel: 8 }).toBuffer();
      }
    }

    const rawSku = (design.sku || '').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const rawTitle = (design.title || '').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const baseClean = (rawSku || rawTitle || 'design').replace(/\.[a-zA-Z0-9]+$/, '') || 'design';
    const downloadFilename = `${baseClean}-preview.png`;

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(outputBuffer);
  } catch (err) {
    console.error('[Preview Download Route Error]:', err);
    return res.status(500).json({ success: false, message: 'Error processing preview download: ' + err.message });
  }
};
