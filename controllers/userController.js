const User = require('../models/User');
const Order = require('../models/Order');
const Wishlist = require('../models/Wishlist');
const Design = require('../models/Design');
const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const { resolveFilePath } = require('../config/storage');

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
  if (!req.user) {
    req.flash('error', 'Please sign in to complete your profile.');
    return res.redirect('/auth/login');
  }

  const profilePicture = (req.user && req.user.profile_picture) || req.session.googlePicture || null;
  const returnUrl = req.session.returnTo || '/user/dashboard';

  res.render('user/complete-profile', {
    title: 'Complete Your Profile - Aruvi Embroidery',
    user: {
      ...req.user,
      profile_picture: profilePicture
    },
    returnUrl
  });
};

exports.postCompleteProfile = async (req, res, next) => {
  try {
    if (!req.user) {
      req.flash('error', 'Session expired. Please sign in again.');
      return res.redirect('/auth/login');
    }

    const { full_name, phone, address } = req.body;

    const cleanName = (full_name || (req.user ? req.user.full_name : '') || '').trim();
    const cleanPhone = (phone || '').trim();
    const cleanAddress = (address || '').trim();
    const profilePicture = (req.user && req.user.profile_picture) || req.session.googlePicture || null;

    if (!cleanName || cleanName.length < 2) {
      req.flash('error', 'Please enter your full name.');
      return res.redirect('/user/complete-profile');
    }

    const digitsOnly = cleanPhone.replace(/\D/g, '');
    if (!cleanPhone || digitsOnly.length < 10) {
      req.flash('error', 'Please enter a valid 10-digit mobile phone number.');
      return res.redirect('/user/complete-profile');
    }

    await User.updateProfile(req.user.id, {
      full_name: cleanName,
      phone: cleanPhone,
      address: cleanAddress,
      profile_picture: profilePicture
    });

    if (req.user) {
      req.user.full_name = cleanName;
      req.user.phone = cleanPhone;
      req.user.address = cleanAddress;
      if (profilePicture) req.user.profile_picture = profilePicture;
    }

    const targetRedirect = req.session.returnTo || '/user/dashboard';
    delete req.session.returnTo;

    req.flash('success', 'Profile confirmed successfully! Welcome to Aruvi Embroidery.');
    res.redirect(targetRedirect);
  } catch (err) {
    console.error('[postCompleteProfile error]:', err);
    req.flash('error', 'Failed to save profile: ' + err.message);
    res.redirect('/user/complete-profile');
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

    const rawTitle = design.title || design.slug || `AED_${targetDesignId}`;
    const cleanFileName = rawTitle.replace(/[/\\?%*:|"<>]/g, '').trim();
    const zipFileName = `${cleanFileName}.zip`;

    // Fast-path: If admin uploaded a single ZIP package, serve the authentic archive directly
    if (machineFiles.length === 1 && machineFiles[0].file_path) {
      const singlePath = resolveFilePath(machineFiles[0].file_path);
      if (singlePath && fs.existsSync(singlePath) && path.extname(singlePath).toLowerCase() === '.zip') {
        await Design.incrementDownloadCount(targetDesignId, {
          userId: req.user ? req.user.id : null,
          ip: req.ip,
          userAgent: req.get('user-agent')
        });
        return res.download(singlePath, zipFileName);
      }
    }

    // 5. Generate or bundle ZIP package using AdmZip
    const zip = new AdmZip();
    let filesAddedCount = 0;

    for (const file of machineFiles) {
      if (!file.file_path) continue;
      const fullPath = resolveFilePath(file.file_path);

      if (fullPath && fs.existsSync(fullPath)) {
        if (path.extname(fullPath).toLowerCase() === '.zip') {
          try {
            const arch = new AdmZip(fullPath);
            arch.getEntries().forEach(entry => {
              if (!entry.isDirectory) {
                zip.addFile(entry.entryName, entry.getData());
              }
            });
            filesAddedCount++;
          } catch (e) {
            const outName = file.file_name || path.basename(fullPath);
            zip.addLocalFile(fullPath, '', outName);
            filesAddedCount++;
          }
        } else {
          const outName = file.file_name || path.basename(fullPath);
          zip.addLocalFile(fullPath, '', outName);
          filesAddedCount++;
        }
      }
    }

    // Never serve fake placeholder ZIPs (sample_peacock.zip) to customers
    if (filesAddedCount === 0) {
      console.error(`[DOWNLOAD ERROR] No persistent machine files found on disk for design #${targetDesignId} ("${rawTitle}"). DB records:`, machineFiles);
      if (isApi) {
        return res.status(404).json({ success: false, message: 'The design files are currently unavailable. Please contact support.' });
      }
      req.flash('error', 'The design files are currently unavailable. Please contact support.');
      return res.redirect('/user/dashboard');
    }

    await Design.incrementDownloadCount(targetDesignId, {
      userId: req.user ? req.user.id : null,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

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
    const sort = req.query.sort || 'latest';
    const items = await Wishlist.getByUser(req.user.id, sort);
    res.render('user/wishlist', {
      title: 'My Wishlist - Aruvi Embroidery',
      items,
      sort
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
