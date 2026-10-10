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
    const { full_name, phone, address } = req.body;
    await User.updateProfile(req.user.id, { full_name, phone, address });
    req.flash('success', 'Profile updated successfully.');
    res.redirect('/user/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.getCompleteProfile = async (req, res) => {
  res.render('user/complete-profile', {
    title: 'Complete Your Profile - Aruvi Embroidery',
    user: req.user
  });
};

exports.postCompleteProfile = async (req, res, next) => {
  try {
    const { full_name, phone, address } = req.body;

    const cleanName = (full_name || (req.user ? req.user.full_name : '') || 'Customer').trim();
    const cleanPhone = (phone || '').trim();
    const cleanAddress = (address || '').trim();

    if (!cleanPhone || cleanPhone.length < 7) {
      req.flash('error', 'Please enter a valid mobile number.');
      return res.redirect('/user/complete-profile');
    }

    await User.updateProfile(req.user.id, {
      full_name: cleanName,
      phone: cleanPhone,
      address: cleanAddress
    });

    req.flash('success', 'Profile completed successfully! Welcome to Aruvi Embroidery.');
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

const AdmZip = require('adm-zip');

exports.downloadDesignZip = async (req, res, next) => {
  try {
    const isApi = req.originalUrl.startsWith('/api/');

    // 1. Authenticate customer
    if (!req.user) {
      if (isApi) {
        return res.status(401).json({ success: false, message: 'Please log in to download designs.' });
      }
      req.flash('error', 'Please log in to download your purchased designs.');
      return res.redirect('/auth/login');
    }

    const userId = req.user.id;
    let targetDesignId = req.params.designId || req.params.fileId || req.params.id;

    // Resolve fileId to design_id if legacy fileId route was hit
    if (db.isConnected() && req.params.fileId) {
      const fileRows = await db.query('SELECT design_id FROM design_files WHERE id = ? LIMIT 1', [req.params.fileId]);
      if (fileRows && fileRows[0]) {
        targetDesignId = fileRows[0].design_id;
      }
    }

    // 2. Verify customer ownership of design (or admin access)
    const hasPurchased = await Order.hasUserPurchasedDesign(userId, targetDesignId);
    const isAdmin = req.user.role === 'admin';

    if (!hasPurchased && !isAdmin) {
      if (isApi) {
        return res.status(403).json({ success: false, message: 'You have not purchased this design.' });
      }
      req.flash('error', 'You must purchase this design before downloading.');
      return res.redirect('/user/dashboard');
    }

    // 3. Retrieve design details
    let design = null;
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM designs WHERE id = ? LIMIT 1', [targetDesignId]);
      if (rows && rows[0]) design = rows[0];
    }
    if (!design) {
      design = await Design.getById(targetDesignId);
    }

    if (!design) {
      if (isApi) {
        return res.status(404).json({ success: false, message: 'Design requested was not found.' });
      }
      req.flash('error', 'Design requested was not found.');
      return res.redirect('/user/dashboard');
    }

    // 4. Retrieve uploaded machine files from design_files table
    let files = [];
    if (db.isConnected()) {
      files = await db.query(
        'SELECT * FROM design_files WHERE design_id = ? AND is_preview = 0 ORDER BY id ASC',
        [targetDesignId]
      ) || [];
    } else if (design.files) {
      files = design.files.filter(f => !f.is_preview);
    }

    // Filter machine files (exclude PNG, JPG, JPEG, WEBP, IMAGE)
    const machineFiles = files.filter(f => {
      const ext = (f.file_format || (f.file_name ? f.file_name.split('.').pop() : '')).toUpperCase();
      return !['PNG', 'JPG', 'JPEG', 'WEBP', 'IMAGE'].includes(ext);
    });

    // 5. Generate ZIP package using AdmZip
    const zip = new AdmZip();
    let filesAddedCount = 0;

    const rawTitle = design.title || design.slug || `AED_${targetDesignId}`;
    const cleanFileName = rawTitle.replace(/[/\\?%*:|"<>]/g, '').trim();
    const zipFileName = `${cleanFileName}.zip`;

    for (const file of machineFiles) {
      let relPath = file.file_path || '';
      if (relPath.startsWith('/')) relPath = relPath.substring(1);
      const fullPath = path.join(__dirname, '..', relPath);

      if (fs.existsSync(fullPath)) {
        const outName = file.file_name || path.basename(fullPath);
        zip.addLocalFile(fullPath, '', outName);
        filesAddedCount++;
      }
    }

    // Fallback if physical files on disk are missing (e.g. sample data in dev)
    if (filesAddedCount === 0) {
      const sampleZipPath = path.join(__dirname, '..', 'public', 'uploads', 'designs', 'sample_peacock.zip');
      if (fs.existsSync(sampleZipPath)) {
        const sampleZip = new AdmZip(sampleZipPath);
        sampleZip.getEntries().forEach(entry => {
          zip.addFile(entry.entryName, entry.getData());
        });
      } else {
        const formatExt = (design.formats ? design.formats.split(',')[0].trim() : 'dst').toLowerCase();
        zip.addFile(`${cleanFileName}.${formatExt}`, Buffer.from(`[Aruvi Embroidery Machine Design File - ${cleanFileName}]`));
      }
    }

    await Design.incrementDownloadCount(targetDesignId);

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);
    res.setHeader('Content-Length', zipBuffer.length);
    return res.send(zipBuffer);

  } catch (err) {
    console.error('downloadDesignZip error:', err);
    next(err);
  }
};

exports.downloadDesignFile = exports.downloadDesignZip;
exports.downloadDesignFormat = exports.downloadDesignZip;
exports.downloadDesignApi = exports.downloadDesignZip;

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
