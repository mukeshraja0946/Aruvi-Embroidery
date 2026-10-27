const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { getPreviewsDir, getDesignsDir } = require('../config/storage');

const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.jfif', '.avif', '.bmp', '.gif', '.tiff'];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const isImageField = ['image', 'preview_images', 'logo_image', 'mobile_logo_image', 'favicon_image', 'hero_image'].includes(file.fieldname);
    if (imageExts.includes(ext) || isImageField || (file.mimetype && file.mimetype.startsWith('image/'))) {
      cb(null, getPreviewsDir());
    } else {
      cb(null, getDesignsDir());
    }
  },
  filename: function (req, file, cb) {
    const randomHex = crypto.randomBytes(8).toString('hex');
    const uniqueSuffix = `${Date.now()}-${randomHex}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext || '.png'}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = [
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.dst', '.pes', '.jef', '.exp', '.hus', '.vip', '.vp3', '.xxx', '.art', '.emb', '.pcs', '.sew', '.csd', '.shv',
    '.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.jfif', '.avif', '.bmp', '.gif', '.tiff'
  ];

  const isImageMime = file.mimetype && file.mimetype.startsWith('image/');
  const isZipMime = file.mimetype && (file.mimetype.includes('zip') || file.mimetype.includes('compressed') || file.mimetype.includes('octet-stream'));

  if (allowedExts.includes(ext) || !ext || isImageMime || isZipMime) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file format. Allowed formats: DST, PES, JEF, EXP, ZIP, RAR, JPG, PNG, WEBP, SVG, AVIF, JFIF, GIF'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 120 * 1024 * 1024 // 120MB limit (supports large machine design ZIP packages)
  }
});

module.exports = upload;
