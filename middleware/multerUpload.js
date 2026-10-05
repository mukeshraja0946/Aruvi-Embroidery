const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const previewsDir = path.join(__dirname, '../public/uploads/previews');
const designsDir = path.join(__dirname, '../public/uploads/designs');

if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true });
if (!fs.existsSync(designsDir)) fs.mkdirSync(designsDir, { recursive: true });

const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.jfif', '.avif', '.bmp', '.gif', '.tiff'];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (imageExts.includes(ext) || file.fieldname === 'image' || (file.mimetype && file.mimetype.startsWith('image/'))) {
      cb(null, previewsDir);
    } else {
      cb(null, designsDir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + '-' + uniqueSuffix + (ext || '.png'));
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
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

module.exports = upload;
