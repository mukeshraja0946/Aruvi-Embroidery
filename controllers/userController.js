const User = require('../models/User');
const Order = require('../models/Order');
const Wishlist = require('../models/Wishlist');
const Design = require('../models/Design');
const db = require('../config/db');
const path = require('path');
const fs = require('fs');

exports.getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const orders = await Order.getByUser(userId);
    const purchasedDesigns = await Order.getPurchasedDesignsByUser(userId);
    const wishlistItems = await Wishlist.getByUser(userId);

    res.render('user/dashboard', {
      title: 'My Account - Aruvi Embroidery',
      orders,
      purchasedDesigns,
      wishlistItems
    });
  } catch (err) {
    next(err);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { full_name, phone } = req.body;
    await User.updateProfile(req.user.id, { full_name, phone });
    req.flash('success', 'Profile updated successfully.');
    res.redirect('/user/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.getOrderDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.getById(id);

    if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
      req.flash('error', 'Order not found.');
      return res.redirect('/user/dashboard');
    }

    res.render('user/order-detail', {
      title: `Order #${order.order_number} - Aruvi Embroidery`,
      order
    });
  } catch (err) {
    next(err);
  }
};

exports.downloadDesignFile = async (req, res, next) => {
  try {
    const fileId = req.params.fileId;
    const userId = req.user.id;

    // Verify ownership of design file
    let fileInfo = null;

    if (db.isConnected()) {
      const sql = `
        SELECT df.file_name, df.file_path, d.title, d.id as design_id
        FROM design_files df
        JOIN designs d ON df.design_id = d.id
        JOIN order_items oi ON d.id = oi.design_id
        JOIN orders o ON oi.order_id = o.id
        WHERE df.id = ? AND o.user_id = ? AND (o.status = 'completed' OR LOWER(o.status) = 'paid')
        LIMIT 1
      `;
      const rows = await db.query(sql, [fileId, userId]);
      fileInfo = rows ? rows[0] : null;
    } else {
      fileInfo = {
        design_id: 1,
        file_name: 'Royal_Bridal_Peacock_Set.zip',
        file_path: '/public/uploads/designs/sample_peacock.zip',
        title: 'Royal Bridal Peacock Neckline & Sleeve Set'
      };
    }

    if (!fileInfo) {
      req.flash('error', 'Download link unauthorized or invalid.');
      return res.redirect('/user/dashboard');
    }

    const absoluteFilePath = path.join(__dirname, '..', fileInfo.file_path);

    if (!fs.existsSync(absoluteFilePath)) {
      req.flash('error', 'Requested design package file was not found on server.');
      return res.redirect('/user/dashboard');
    }

    if (fileInfo.design_id) {
      await Design.incrementDownloadCount(fileInfo.design_id);
    }

    res.download(absoluteFilePath, fileInfo.file_name);
  } catch (err) {
    next(err);
  }
};

exports.downloadDesignFormat = async (req, res, next) => {
  try {
    const { designId, format } = req.params;
    const userId = req.user.id;

    // Verify customer purchase authorization
    const hasPurchased = await Order.hasUserPurchasedDesign(userId, designId);
    if (!hasPurchased && req.user.role !== 'admin') {
      req.flash('error', 'You must purchase this design before downloading.');
      return res.redirect('/user/dashboard');
    }

    let fileInfo = null;
    if (db.isConnected()) {
      const sql = `
        SELECT df.file_name, df.file_path, df.file_format, d.title
        FROM design_files df
        JOIN designs d ON df.design_id = d.id
        WHERE df.design_id = ? AND UPPER(df.file_format) = UPPER(?)
        LIMIT 1
      `;
      const rows = await db.query(sql, [designId, format]);
      if (rows && rows[0]) fileInfo = rows[0];
    }

    if (!fileInfo) {
      const design = await Design.getById(designId);
      if (design && design.files) {
        fileInfo = design.files.find(f => (f.file_format || '').toUpperCase() === (format || '').toUpperCase());
      }
      if (!fileInfo) {
        fileInfo = {
          file_name: `${(design ? design.slug : 'design')}_${format.toUpperCase()}.${format.toLowerCase()}`,
          file_path: '/public/uploads/designs/sample_peacock.zip',
          title: design ? design.title : 'Embroidery Design'
        };
      }
    }

    const absoluteFilePath = path.join(__dirname, '..', fileInfo.file_path);

    if (!fs.existsSync(absoluteFilePath)) {
      req.flash('error', 'Requested design package file was not found on server.');
      return res.redirect('/user/dashboard');
    }

    await Design.incrementDownloadCount(designId);

    const downloadFileName = fileInfo.file_name || `Design_${designId}_${format.toUpperCase()}.${format.toLowerCase()}`;
    return res.download(absoluteFilePath, downloadFileName);
  } catch (err) {
    next(err);
  }
};

exports.downloadDesignApi = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: 'Payment required to download this design'
      });
    }

    const { designId } = req.params;
    const userId = req.user.id;

    const hasPurchased = await Order.hasUserPurchasedDesign(userId, designId);
    if (!hasPurchased && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Payment required to download this design'
      });
    }

    let fileInfo = null;
    if (db.isConnected()) {
      const sql = `
        SELECT df.file_name, df.file_path, d.title
        FROM design_files df
        JOIN designs d ON df.design_id = d.id
        WHERE df.design_id = ?
        LIMIT 1
      `;
      const rows = await db.query(sql, [designId]);
      if (rows && rows[0]) fileInfo = rows[0];
    }

    if (!fileInfo) {
      const design = await Design.getById(designId);
      fileInfo = {
        file_name: `${(design ? design.slug : 'design')}.zip`,
        file_path: '/public/uploads/designs/sample_peacock.zip',
        title: design ? design.title : 'Embroidery Design'
      };
    }

    const absoluteFilePath = path.join(__dirname, '..', fileInfo.file_path);

    if (!fs.existsSync(absoluteFilePath)) {
      return res.status(404).json({ success: false, message: 'Requested design package file was not found on server.' });
    }

    await Design.incrementDownloadCount(designId);
    return res.download(absoluteFilePath, fileInfo.file_name);
  } catch (err) {
    next(err);
  }
};

exports.getWishlist = async (req, res, next) => {
  try {
    const items = await Wishlist.getByUser(req.user.id);
    res.render('user/wishlist', {
      title: 'My Wishlist - Aruvi Embroidery',
      items
    });
  } catch (err) {
    next(err);
  }
};

exports.toggleWishlist = async (req, res, next) => {
  try {
    const { design_id } = req.body;
    if (!req.user) {
      return res.json({ success: false, message: 'Please login to save to wishlist.' });
    }

    const isIn = await Wishlist.isInWishlist(req.user.id, design_id);
    if (isIn) {
      await Wishlist.remove(req.user.id, design_id);
      return res.json({ success: true, status: 'removed', message: 'Removed from wishlist.' });
    } else {
      await Wishlist.add(req.user.id, design_id);
      return res.json({ success: true, status: 'added', message: 'Saved to your wishlist!' });
    }
  } catch (err) {
    next(err);
  }
};
