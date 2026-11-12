const User = require('../models/User');
const Order = require('../models/Order');
const Wishlist = require('../models/Wishlist');
const CustomRequest = require('../models/CustomRequest');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiverModule = require('archiver');
const { resolveFilePath } = require('../config/storage');

const AdmZip = require('adm-zip');

function createZipArchive(options = { zlib: { level: 6 } }) {
  if (typeof archiverModule === 'function') {
    return archiverModule('zip', options);
  }
  if (archiverModule && archiverModule.ZipArchive) {
    return new archiverModule.ZipArchive(options);
  }
  if (archiverModule && archiverModule.default && typeof archiverModule.default === 'function') {
    return archiverModule.default('zip', options);
  }
  throw new Error('Unable to initialize zip archiver stream');
}

/**
 * Checks if a filename or archive entry is an OS artifact, temp file, or unwanted image
 */
function isJunkOrIgnoredFile(filename) {
  if (!filename || typeof filename !== 'string') return false;
  const base = path.basename(filename).toLowerCase();
  const full = filename.toLowerCase().replace(/\\/g, '/');
  if (base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini') return true;
  if (base.startsWith('._') || base.endsWith('.tmp') || base.endsWith('.crdownload')) return true;
  if (full.includes('__macosx/') || full.startsWith('__macosx')) return true;
  const ext = path.extname(base);
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.avif', '.gif'].includes(ext)) return true;
  return false;
}

function filterDistinctFiles(files) {
  if (!Array.isArray(files)) return [];
  const seenIds = new Set();
  const seenSignatures = new Set();
  const distinct = [];
  for (const f of files) {
    if (!f) continue;
    // Discard preview or image records
    if (f.file_kind === 'image' || f.is_preview === 1 || f.is_preview === true) continue;
    const fmt = (f.file_format || '').toUpperCase();
    if (['PNG', 'JPG', 'JPEG', 'WEBP', 'SVG', 'AVIF', 'GIF'].includes(fmt)) continue;
    const name = f.original_name || f.file_name || f.storage_key || '';
    if (isJunkOrIgnoredFile(name)) continue;

    const sig = f.checksum_sha256 ? `chk_${f.checksum_sha256}` : (f.storage_key || f.file_path || `id_${f.id}`);
    if (!seenIds.has(f.id) && !seenSignatures.has(sig)) {
      seenIds.add(f.id);
      seenSignatures.add(sig);
      distinct.push(f);
    }
  }
  return distinct;
}

exports.getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const orders = await Order.getByUser(userId);
    const purchasedDesigns = await Order.getPurchasedDesignsByUser(userId);
    const wishlistItems = await Wishlist.getByUser(userId);

    // Attach all download files for each purchased design (strictly machine files, no junk or images)
    if (db.isConnected() && Array.isArray(purchasedDesigns)) {
      for (const item of purchasedDesigns) {
        const dId = item.design_id || item.id;
        if (item.variant_id) {
          const vRows = await db.query(
            `SELECT dfv.id as variant_id, dfv.variant_name, dfv.original_name, dfv.storage_key, dfv.file_size, dfv.file_format,
                    df.id as file_id, df.label
             FROM design_file_variants dfv
             LEFT JOIN design_files df ON dfv.file_id = df.id
             WHERE dfv.id = ?`,
            [item.variant_id]
          );
          if (vRows && vRows.length > 0) {
            const v = vRows[0];
            item.download_files = [{
              id: v.file_id || v.variant_id,
              label: v.variant_name,
              original_name: v.original_name || `${v.variant_name}.${v.file_format || 'DST'}`,
              file_format: v.file_format || 'DST',
              file_size: v.file_size || 0,
              variant_id: v.variant_id
            }];
            item.display_title = `${item.title} - ${v.variant_name}`;
          } else {
            item.download_files = [];
            item.display_title = item.title;
          }
        } else {
          const files = await db.query(
            "SELECT id, label, original_name, storage_key, mime_type, file_size, file_format, file_name, file_path, checksum_sha256 FROM design_files WHERE design_id = ? AND file_kind NOT IN ('image', 'preview') AND is_preview = 0 AND UPPER(COALESCE(file_format, '')) NOT IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF','GIF') ORDER BY sort_order ASC, id ASC",
            [dId]
          );
          item.download_files = filterDistinctFiles(files || []);
          item.display_title = item.title;
        }
      }
    }

    // Fetch customer's custom design requests
    let customRequests = [];
    try {
      customRequests = await CustomRequest.getByUser(userId);
    } catch (crErr) {
      console.warn('[User Dashboard Warning] CustomRequest fetch error:', crErr.message);
    }

    res.render('user/dashboard', {
      title: 'My Account - Aruvi Embroidery',
      orders,
      purchasedDesigns,
      wishlistItems,
      customRequests: customRequests || []
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

    // Attach all download files for each design in this order (strictly machine files, no junk or images)
    if (db.isConnected() && Array.isArray(order.items)) {
      for (const item of order.items) {
        const dId = item.design_id || item.id;
        const files = await db.query(
          "SELECT id, label, original_name, storage_key, mime_type, file_size, file_format, file_name, file_path, checksum_sha256 FROM design_files WHERE design_id = ? AND file_kind NOT IN ('image', 'preview') AND is_preview = 0 AND UPPER(COALESCE(file_format, '')) NOT IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF','GIF') ORDER BY sort_order ASC, id ASC",
          [dId]
        );
        item.download_files = filterDistinctFiles(files || []);
      }
    }

    res.render('user/order-detail', {
      title: `Order #${order.order_number} - Aruvi Embroidery`,
      order
    });
  } catch (err) {
    next(err);
  }
};

// =========================================================================
// DOWNLOAD AUTHORIZATION, SIGNED TOKEN & LOGGING HELPERS
// =========================================================================

const DOWNLOAD_TOKEN_SECRET = process.env.SESSION_SECRET || 'aruvi-embroidery-secure-download-token-key';

function generateDownloadToken(userId, fileOrDesignId, expiresInSeconds = 86400) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${userId}:${fileOrDesignId}:${expires}`;
  const sig = crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(payload).digest('hex');
  return { token: `${expires}.${sig}`, expires };
}

function verifyDownloadToken(userId, fileOrDesignId, tokenStr) {
  if (!tokenStr) return false;
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return false;
  const [expiresStr, sig] = parts;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || Date.now() / 1000 > expires) return false;
  const payload = `${userId}:${fileOrDesignId}:${expires}`;
  const expectedSig = crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch {
    return false;
  }
}

async function authorizeDownload(req, designId) {
  if (req.user) {
    if (req.user.role === 'admin') {
      return { authorized: true, isAdmin: true, userId: req.user.id };
    }
    const hasPurchased = await Order.hasUserPurchasedDesign(req.user.id, designId);
    if (hasPurchased) {
      return { authorized: true, isAdmin: false, userId: req.user.id };
    }
  }

  // Check short-lived signed token in query string (?token=...&uid=...)
  if (req.query && req.query.token && req.query.uid) {
    const uid = parseInt(req.query.uid, 10);
    if (!isNaN(uid) && verifyDownloadToken(uid, designId, req.query.token)) {
      const hasPurchased = await Order.hasUserPurchasedDesign(uid, designId);
      if (hasPurchased) {
        return { authorized: true, isAdmin: false, userId: uid };
      }
    }
  }

  return { authorized: false, isAdmin: false, userId: null };
}

async function checkFileDownloadLimit(userId, fileId) {
  if (!userId) return { allowed: true };
  const limitVal = parseInt(await Setting.get('download_limit_per_file', '0'), 10);
  if (!limitVal || limitVal <= 0) return { allowed: true };

  if (db.isConnected()) {
    const [countRow] = await db.query(
      'SELECT COUNT(*) AS total FROM download_logs WHERE user_id = ? AND file_id = ?',
      [userId, fileId]
    );
    const total = countRow ? countRow.total : 0;
    if (total >= limitVal) {
      return { allowed: false, limit: limitVal, current: total };
    }
  }
  return { allowed: true };
}

async function recordDownloadLog({ userId, designId, fileId, req, isAdmin }) {
  try {
    if (db.isConnected()) {
      await db.query(
        'INSERT INTO download_logs (user_id, design_id, file_id, ip_address, user_agent, downloaded_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [userId || null, designId, fileId || null, req.ip || null, (req.get('user-agent') || '').slice(0, 500)]
      );
    }
    // Increment design download_count strictly for authentic customer downloads (never for admin)
    if (!isAdmin && designId) {
      await Design.incrementDownloadCount(designId, {
        userId: userId || null,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
    }
  } catch (logErr) {
    console.warn('[recordDownloadLog warning]:', logErr.message);
  }
}

// =========================================================================
// 1. INDIVIDUAL FILE DOWNLOAD (WITH HTTP RANGE / RESUME SUPPORT)
// =========================================================================

exports.downloadSingleFile = async (req, res, next) => {
  try {
    const isApi = req.originalUrl.startsWith('/api/');
    const fileId = parseInt(req.params.fileId, 10);

    if (isNaN(fileId) || fileId <= 0) {
      if (isApi) return res.status(400).json({ success: false, message: 'Invalid file ID.' });
      req.flash('error', 'Invalid file requested.');
      return res.redirect('/user/dashboard');
    }

    if (!db.isConnected()) await db.initPool();

    const [fileRow] = await db.query(
      'SELECT df.*, d.title AS design_title, d.sku AS design_sku FROM design_files df JOIN designs d ON df.design_id = d.id WHERE df.id = ? LIMIT 1',
      [fileId]
    );

    if (!fileRow) {
      if (isApi) return res.status(404).json({ success: false, message: 'File requested does not exist.' });
      req.flash('error', 'File requested does not exist.');
      return res.redirect('/user/dashboard');
    }

    // Verify ownership
    const auth = await authorizeDownload(req, fileRow.design_id);
    if (!auth.authorized) {
      if (isApi) return res.status(403).json({ success: false, message: 'You have not purchased this design.' });
      req.flash('error', 'You must purchase this design before downloading its files.');
      return res.redirect('/user/dashboard');
    }

    // Check per-file download limit if applicable
    if (!auth.isAdmin) {
      const limitCheck = await checkFileDownloadLimit(auth.userId, fileId);
      if (!limitCheck.allowed) {
        const msg = `You have reached the maximum download limit (${limitCheck.limit}) for this file. Please contact support if you need assistance.`;
        if (isApi) return res.status(429).json({ success: false, message: msg });
        req.flash('error', msg);
        return res.redirect('/user/dashboard');
      }
    }

    const fullPath = resolveFilePath(fileRow.storage_key || fileRow.file_path);
    if (!fullPath || !fs.existsSync(fullPath)) {
      console.error(`[DOWNLOAD ERROR] File #${fileId} not found on disk at:`, fullPath);
      if (isApi) return res.status(404).json({ success: false, message: 'This design file is currently unavailable on server. Please contact support.' });
      req.flash('error', 'This file is currently unavailable. Please contact support.');
      return res.redirect('/user/dashboard');
    }

    const stat = fs.statSync(fullPath);
    const downloadFileName = fileRow.original_name || fileRow.file_name || path.basename(fullPath);
    const mimeType = fileRow.mime_type || 'application/octet-stream';

    // Log the download event
    await recordDownloadLog({
      userId: auth.userId,
      designId: fileRow.design_id,
      fileId,
      req,
      isAdmin: auth.isAdmin
    });

    // Check for HTTP Range Header (for Resumable Downloads on Mobile / Large files)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

      if (start >= stat.size || end >= stat.size) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(fullPath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': 'no-transform, private, no-cache',
        'Content-Encoding': 'identity',
        'Content-Disposition': `attachment; filename="${downloadFileName}"; filename*=UTF-8''${encodeURIComponent(downloadFileName)}`
      });
      return fileStream.pipe(res);
    }

    // Standard stream download
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-transform, private, no-cache');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"; filename*=UTF-8''${encodeURIComponent(downloadFileName)}`);

    const stream = fs.createReadStream(fullPath);
    stream.on('error', (err) => {
      console.error('File stream error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    return stream.pipe(res);

  } catch (err) {
    console.error('downloadSingleFile error:', err);
    next(err);
  }
};

// =========================================================================
// 2. DESIGN COMBINED "DOWNLOAD ALL (ZIP)" STREAMING
// =========================================================================

exports.downloadDesignAllZip = async (req, res, next) => {
  try {
    const isApi = req.originalUrl.startsWith('/api/');
    let targetDesignId = parseInt(req.params.designId || req.params.fileId || req.params.id, 10);

    if (isNaN(targetDesignId) || targetDesignId <= 0) {
      if (isApi) return res.status(400).json({ success: false, message: 'Invalid design ID.' });
      req.flash('error', 'Invalid design requested.');
      return res.redirect('/user/dashboard');
    }

    if (!db.isConnected()) await db.initPool();

    const [design] = await db.query('SELECT * FROM designs WHERE id = ? LIMIT 1', [targetDesignId]);
    if (!design) {
      if (isApi) return res.status(404).json({ success: false, message: 'Design not found.' });
      req.flash('error', 'Design not found.');
      return res.redirect('/user/dashboard');
    }

    // Authorize buyer
    const auth = await authorizeDownload(req, targetDesignId);
    if (!auth.authorized) {
      if (isApi) return res.status(403).json({ success: false, message: 'You have not purchased this design.' });
      req.flash('error', 'You must purchase this design before downloading.');
      return res.redirect('/user/dashboard');
    }

    // Check if a specific variant was requested or purchased by this user
    let targetVariantId = req.query.variant_id ? parseInt(req.query.variant_id, 10) : null;
    if (!targetVariantId && auth.userId) {
      const purchasedVariantRows = await db.query(
        `SELECT oi.variant_id
         FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         WHERE o.user_id = ? AND oi.design_id = ? AND oi.variant_id IS NOT NULL AND (o.status = 'completed' OR LOWER(o.status) = 'paid')
         ORDER BY o.id DESC LIMIT 1`,
        [auth.userId, targetDesignId]
      );
      if (purchasedVariantRows && purchasedVariantRows[0] && purchasedVariantRows[0].variant_id) {
        targetVariantId = purchasedVariantRows[0].variant_id;
      }
    }

    if (targetVariantId) {
      const [variantRow] = await db.query(
        `SELECT dfv.*, df.storage_key as df_storage_key, df.file_path as df_file_path, df.file_name as df_file_name, df.original_name as df_original_name
         FROM design_file_variants dfv
         LEFT JOIN design_files df ON dfv.file_id = df.id
         WHERE dfv.id = ? AND dfv.design_id = ?`,
        [targetVariantId, targetDesignId]
      );

      if (variantRow) {
        const candidateKey = variantRow.storage_key || variantRow.df_storage_key || variantRow.df_file_path || variantRow.file_name;
        const variantDiskPath = resolveFilePath(candidateKey);
        if (variantDiskPath && fs.existsSync(variantDiskPath)) {
          const dlName = variantRow.original_name || variantRow.df_original_name || variantRow.file_name || path.basename(variantDiskPath);
          const ext = path.extname(dlName).toLowerCase();
          let mimeType = 'application/octet-stream';
          if (ext === '.zip') mimeType = 'application/zip';
          else if (ext === '.dst') mimeType = 'application/x-dst';
          else if (ext === '.pes') mimeType = 'application/x-pes';
          else if (ext === '.jef') mimeType = 'application/x-jef';
          else if (ext === '.exp') mimeType = 'application/x-exp';

          const stat = fs.statSync(variantDiskPath);
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Length', stat.size);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'no-transform, private, no-cache');
          res.setHeader('Content-Disposition', `attachment; filename="${dlName}"; filename*=UTF-8''${encodeURIComponent(dlName)}`);

          await recordDownloadLog({
            userId: auth.userId,
            designId: targetDesignId,
            fileId: variantRow.file_id || null,
            req,
            isAdmin: auth.isAdmin
          });

          const fileStream = fs.createReadStream(variantDiskPath);
          fileStream.on('error', (err) => {
            console.error('Variant file stream error:', err);
            if (!res.headersSent) res.status(500).end();
          });
          return fileStream.pipe(res);
        }
      }
    }

    // Retrieve all non-preview machine files for this design (strictly distinct machine files only, no images or junk)
    const rawFiles = await db.query(
      "SELECT * FROM design_files WHERE design_id = ? AND file_kind NOT IN ('image', 'preview') AND is_preview = 0 AND UPPER(COALESCE(file_format, '')) NOT IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF','GIF') ORDER BY sort_order ASC, id ASC",
      [targetDesignId]
    ) || [];
    const machineFiles = filterDistinctFiles(rawFiles);

    const rawTitle = design.title || design.slug || `AED_${targetDesignId}`;
    const cleanFileName = (design.sku ? `${design.sku}_${rawTitle}` : rawTitle).replace(/[/\\?%*:|"<>]/g, '_').trim();
    const zipFileName = `${cleanFileName}.zip`;

    // Fast-path: If design has exactly 1 file and it's already a valid ZIP archive on disk
    if (machineFiles.length === 1 && machineFiles[0].storage_key) {
      const singlePath = resolveFilePath(machineFiles[0].storage_key || machineFiles[0].file_path);
      if (singlePath && fs.existsSync(singlePath) && path.extname(singlePath).toLowerCase() === '.zip') {
        try {
          const zip = new AdmZip(singlePath);
          const entries = zip.getEntries();
          let hasJunk = false;
          for (const e of entries) {
            if (isJunkOrIgnoredFile(e.entryName)) {
              hasJunk = true;
              zip.deleteFile(e);
            }
          }
          if (hasJunk) {
            const cleanBuf = zip.toBuffer();
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);
            res.setHeader('Content-Length', cleanBuf.length);
            res.setHeader('Cache-Control', 'no-transform, private, no-cache');
            await recordDownloadLog({
              userId: auth.userId,
              designId: targetDesignId,
              fileId: machineFiles[0].id,
              req,
              isAdmin: auth.isAdmin
            });
            return res.end(cleanBuf);
          }
        } catch (zErr) {
          console.warn('[ZIP Inspection Warning]:', zErr.message);
        }

        await recordDownloadLog({
          userId: auth.userId,
          designId: targetDesignId,
          fileId: machineFiles[0].id,
          req,
          isAdmin: auth.isAdmin
        });
        return res.download(singlePath, zipFileName);
      }
    }

    // Verify at least one file exists on disk
    const validDiskFiles = [];
    for (const f of machineFiles) {
      const full = resolveFilePath(f.storage_key || f.file_path);
      if (full && fs.existsSync(full)) {
        const baseName = path.basename(full);
        if (!isJunkOrIgnoredFile(baseName)) {
          validDiskFiles.push({ record: f, fullPath: full });
        }
      }
    }

    if (validDiskFiles.length === 0) {
      console.error(`[DOWNLOAD ERROR] No persistent machine files found on disk for design #${targetDesignId}`);
      if (isApi) return res.status(404).json({ success: false, message: 'Files for this design are currently unavailable on server. Please contact support.' });
      req.flash('error', 'Design files are currently unavailable. Please contact support.');
      return res.redirect('/user/dashboard');
    }

    // Stream on-the-fly dynamically using archiver in store-only mode (preserves original bytes, zero compression loss)
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-transform, private, no-cache');
    res.setHeader('Content-Encoding', 'identity');

    const archive = createZipArchive({ zlib: { level: 0 }, store: true });

    archive.on('error', (err) => {
      console.error('[Archiver Stream Error]:', err);
      if (!res.headersSent) res.status(500).end();
    });

    archive.pipe(res);

    for (const it of validDiskFiles) {
      const entryName = it.record.original_name || it.record.file_name || path.basename(it.fullPath);
      if (!isJunkOrIgnoredFile(entryName)) {
        archive.file(it.fullPath, { name: entryName });
      }
    }

    await archive.finalize();

    // Log the download event
    await recordDownloadLog({
      userId: auth.userId,
      designId: targetDesignId,
      fileId: machineFiles[0] ? machineFiles[0].id : null,
      req,
      isAdmin: auth.isAdmin
    });

  } catch (err) {
    console.error('downloadDesignAllZip error:', err);
    next(err);
  }
};

// =========================================================================
// 3. ORDER-LEVEL "DOWNLOAD EVERYTHING (ZIP)" STREAMING
// =========================================================================

exports.downloadOrderAllZip = async (req, res, next) => {
  try {
    const isApi = req.originalUrl.startsWith('/api/');
    const orderId = parseInt(req.params.orderId || req.params.id, 10);

    if (isNaN(orderId) || orderId <= 0) {
      if (isApi) return res.status(400).json({ success: false, message: 'Invalid order ID.' });
      req.flash('error', 'Invalid order requested.');
      return res.redirect('/user/dashboard');
    }

    if (!db.isConnected()) await db.initPool();

    const order = await Order.getById(orderId);
    if (!order) {
      if (isApi) return res.status(404).json({ success: false, message: 'Order not found.' });
      req.flash('error', 'Order not found.');
      return res.redirect('/user/dashboard');
    }

    const isAdmin = req.user && req.user.role === 'admin';
    const isOwner = req.user && req.user.id === order.user_id;

    if (!isAdmin && !isOwner) {
      if (isApi) return res.status(403).json({ success: false, message: 'Access denied to this order.' });
      req.flash('error', 'Access denied to this order.');
      return res.redirect('/user/dashboard');
    }

    const isPaid = (order.status === 'completed' || order.status === 'paid' || order.payment_status === 'completed' || order.payment_status === 'PAID');
    if (!isPaid && !isAdmin) {
      if (isApi) return res.status(403).json({ success: false, message: 'Order has not been paid yet.' });
      req.flash('error', 'Downloads unlock after payment is confirmed.');
      return res.redirect(`/user/orders/${orderId}`);
    }

    const items = order.items || [];
    if (items.length === 0) {
      req.flash('error', 'No items found in this order.');
      return res.redirect(`/user/orders/${orderId}`);
    }

    const zipFileName = `Order-${order.order_number || orderId}-All-Designs.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-transform, private, no-cache');
    res.setHeader('Content-Encoding', 'identity');

    const archive = createZipArchive({ zlib: { level: 0 }, store: true });

    archive.on('error', (err) => {
      console.error('[Order Archiver Stream Error]:', err);
      if (!res.headersSent) res.status(500).end();
    });

    archive.pipe(res);

    let totalFilesInOrder = 0;

    for (const item of items) {
      const dId = item.design_id || item.id;
      const cleanDesignDir = `${item.sku || `AED-${dId}`}_${(item.title || 'Design').replace(/[/\\?%*:|"<>]/g, '_').trim()}`;

      if (item.variant_id) {
        const [variantRow] = await db.query(
          `SELECT dfv.*, df.storage_key as df_storage_key, df.file_path as df_file_path, df.file_name as df_file_name, df.original_name as df_original_name
           FROM design_file_variants dfv
           LEFT JOIN design_files df ON dfv.file_id = df.id
           WHERE dfv.id = ?`,
          [item.variant_id]
        );
        if (variantRow) {
          const candidateKey = variantRow.storage_key || variantRow.df_storage_key || variantRow.df_file_path || variantRow.file_name;
          const full = resolveFilePath(candidateKey);
          if (full && fs.existsSync(full)) {
            const entryName = variantRow.original_name || variantRow.df_original_name || variantRow.file_name || path.basename(full);
            if (!isJunkOrIgnoredFile(entryName)) {
              archive.file(full, { name: `${cleanDesignDir}/${entryName}` });
              totalFilesInOrder++;
            }
          }
        }
      } else {
        const rawFiles = await db.query(
          "SELECT * FROM design_files WHERE design_id = ? AND file_kind NOT IN ('image', 'preview') AND is_preview = 0 AND UPPER(COALESCE(file_format, '')) NOT IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF','GIF') ORDER BY sort_order ASC, id ASC",
          [dId]
        ) || [];
        const files = filterDistinctFiles(rawFiles);

        for (const f of files) {
          const full = resolveFilePath(f.storage_key || f.file_path);
          if (full && fs.existsSync(full)) {
            const entryName = f.original_name || f.file_name || path.basename(full);
            if (!isJunkOrIgnoredFile(entryName)) {
              archive.file(full, { name: `${cleanDesignDir}/${entryName}` });
              totalFilesInOrder++;
            }
          }
        }
      }

      await recordDownloadLog({
        userId: order.user_id,
        designId: dId,
        fileId: null,
        req,
        isAdmin
      });
    }

    if (totalFilesInOrder === 0) {
      archive.append('No files currently available for the designs in this order.', { name: 'README.txt' });
    }

    await archive.finalize();

  } catch (err) {
    console.error('downloadOrderAllZip error:', err);
    next(err);
  }
};

// Backwards-compatible aliases
exports.downloadDesignZip = exports.downloadDesignAllZip;
exports.downloadDesignFile = exports.downloadDesignAllZip;
exports.downloadDesignFormat = exports.downloadDesignAllZip;
exports.downloadDesignApi = exports.downloadDesignAllZip;

exports.getWishlist = async (req, res, next) => {
  try {
    const sort = req.query.sort || 'latest';
    let items = [];
    let inactiveCount = 0;

    if (req.user) {
      items = await Wishlist.getByUser(req.user.id, sort);
      inactiveCount = await Wishlist.countInactive(req.user.id);
    }

    res.render('user/wishlist', {
      title: 'My Saved Wishlist - Aruvi Embroidery',
      items,
      sort,
      inactiveCount,
      isGuest: !req.user
    });
  } catch (err) {
    next(err);
  }
};

exports.toggleWishlist = async (req, res, next) => {
  try {
    const { design_id } = req.body;
    if (!req.user) {
      return res.status(200).json({
        success: false,
        requireLogin: true,
        message: 'Please log in to save designs to your wishlist.'
      });
    }

    if (!design_id) {
      return res.status(400).json({ success: false, message: 'Design ID missing.' });
    }

    const isIn = await Wishlist.isInWishlist(req.user.id, design_id);
    if (isIn) {
      await Wishlist.remove(req.user.id, design_id);
      const count = await Wishlist.getCount(req.user.id);
      return res.json({
        success: true,
        status: 'removed',
        count,
        message: 'Removed from wishlist.'
      });
    } else {
      await Wishlist.add(req.user.id, design_id);
      const count = await Wishlist.getCount(req.user.id);
      return res.json({
        success: true,
        status: 'added',
        count,
        message: 'Saved to your wishlist!'
      });
    }
  } catch (err) {
    console.error('toggleWishlist error:', err);
    res.status(500).json({ success: false, message: 'Failed to update wishlist.' });
  }
};

exports.mergeWishlist = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(200).json({ success: false, message: 'User not logged in' });
    }
    const { design_ids } = req.body;
    if (Array.isArray(design_ids) && design_ids.length > 0) {
      await Wishlist.mergeWishlist(req.user.id, design_ids);
    }
    const count = await Wishlist.getCount(req.user.id);
    return res.json({
      success: true,
      count,
      message: 'Wishlist synchronized successfully.'
    });
  } catch (err) {
    console.error('mergeWishlist error:', err);
    res.status(500).json({ success: false, message: 'Failed to merge wishlist.' });
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    if (!current_password || !new_password || !confirm_password) {
      req.flash('error', 'All password fields are required.');
      return res.redirect('/user/dashboard');
    }
    if (new_password !== confirm_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/user/dashboard');
    }
    if (new_password.length < 6) {
      req.flash('error', 'New password must be at least 6 characters long.');
      return res.redirect('/user/dashboard');
    }

    const fullUser = await User.findByEmail(req.user.email);
    if (!fullUser) {
      req.flash('error', 'User account not found.');
      return res.redirect('/user/dashboard');
    }

    const isMatch = await User.verifyPassword(current_password, fullUser.password_hash);
    if (!isMatch) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/user/dashboard');
    }

    await User.updatePassword(req.user.id, new_password);
    req.flash('success', 'Your password has been updated successfully!');
    res.redirect('/user/dashboard');
  } catch (err) {
    next(err);
  }
};
