const CustomRequest = require('../../models/CustomRequest');
const ActivityLog = require('../../models/ActivityLog');
const storage = require('../../config/storage');
const path = require('path');
const fs = require('fs');

/**
 * List all custom design requests with filtering, search, and pagination
 */
exports.getCustomOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const sort = req.query.sort || 'newest';
    const search = req.query.search || null;
    const status = req.query.status || null;

    const { requests, total } = await CustomRequest.getAll({ page, limit: 15, sort, search, status });
    const stats = await CustomRequest.getStats();

    res.render('admin/custom-orders/index', {
      title: 'Custom Order Requests - Admin',
      requests: requests || [],
      total: total || 0,
      stats,
      currentPage: page,
      totalPages: Math.ceil((total || 0) / 15) || 1,
      currentSort: sort,
      currentSearch: search || '',
      currentStatus: status || '',
      csrfToken: (typeof req.csrfToken === 'function') ? req.csrfToken() : (res.locals.csrfToken || '')
    });
  } catch (err) {
    next(err);
  }
};

/**
 * API: Get single custom request details (JSON for modal / AJAX inspection)
 */
exports.getCustomOrderDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await CustomRequest.getById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Custom order request not found.' });
    }
    res.json({ success: true, request });
  } catch (err) {
    next(err);
  }
};

/**
 * Authenticated preview route for private reference images
 * Strictly accessible ONLY by logged-in admin users
 */
exports.previewReferenceImage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await CustomRequest.getById(id);

    if (!request || !request.reference_image_key) {
      return res.status(404).send('Reference image not found.');
    }

    const uploadsDir = storage.getUploadsDir();
    const key = request.reference_image_key;

    // Potential locations for the private image
    const candidatePaths = [
      path.join(uploadsDir, 'private', key),
      path.join(uploadsDir, 'private', 'custom-requests', path.basename(key)),
      path.join(uploadsDir, key),
      path.join(process.cwd(), 'storage_private', key),
      path.join(process.cwd(), 'public', key.replace(/^\//, ''))
    ];

    let foundPath = candidatePaths.find(p => fs.existsSync(p));

    if (!foundPath) {
      console.warn(`[Custom Order Image Warning] Image file not found for request #${id}: ${key}`);
      return res.status(404).send('Image file not found on disk.');
    }

    const ext = path.extname(foundPath).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };

    const contentType = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    
    fs.createReadStream(foundPath).pipe(res);
  } catch (err) {
    console.error('Reference image preview error:', err);
    res.status(500).send('Error serving reference image preview.');
  }
};

/**
 * Update request status, admin notes, and optionally quote price
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, admin_notes, quoted_price } = req.body;

    await CustomRequest.updateStatus(id, status, admin_notes, quoted_price);
    await ActivityLog.logFromReq(req, 'update_status', 'custom_order', id, `Updated custom request #${id} status to "${status}"`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, message: `Status updated to "${status}".` });
    }

    req.flash('success', `Custom request #${id} status updated to "${status}".`);
    res.redirect('/admin/custom-orders');
  } catch (err) {
    next(err);
  }
};

/**
 * Save quoted price and admin notes
 */
exports.quotePrice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { quoted_price, admin_notes, status = 'quoted' } = req.body;

    await CustomRequest.updateStatus(id, status, admin_notes, quoted_price);
    await ActivityLog.logFromReq(req, 'quote_price', 'custom_order', id, `Quoted price ₹${quoted_price} for request #${id}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, message: `Price quote of ₹${quoted_price} saved successfully.` });
    }

    req.flash('success', `Price quote of ₹${quoted_price} saved for request #${id}.`);
    res.redirect('/admin/custom-orders');
  } catch (err) {
    next(err);
  }
};

/**
 * Delete custom design request
 */
exports.deleteCustomOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    await CustomRequest.delete(id);
    await ActivityLog.logFromReq(req, 'delete', 'custom_order', id, `Deleted custom request #${id}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'Custom order deleted successfully.' });
    }

    req.flash('success', 'Custom order deleted successfully.');
    res.redirect('/admin/custom-orders');
  } catch (err) {
    console.error('Delete custom order error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete custom order.' });
    }
    req.flash('error', `Unable to delete custom order: ${err.message}`);
    res.redirect('/admin/custom-orders');
  }
};
