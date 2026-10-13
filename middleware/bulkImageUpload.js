const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { getPreviewsDir } = require('../config/storage');

const allowedImageExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

const bulkStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      cb(null, getPreviewsDir());
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const randomHex = crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `bulk-${Date.now()}-${randomHex}${ext || '.png'}`);
  }
});

const bulkFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isImageMime = file.mimetype && file.mimetype.startsWith('image/');
  
  if (allowedImageExts.includes(ext) || isImageMime) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for "${file.originalname}". Only JPG, PNG, WEBP, and AVIF are supported.`));
  }
};

const multerBulkInstance = multer({
  storage: bulkStorage,
  fileFilter: bulkFileFilter,
  limits: {
    files: 10, // Small batch limit: max 10 files per request
    fileSize: 10 * 1024 * 1024 // 10MB per file
  }
}).array('images', 10);

/**
 * Express middleware that catches multer limit / parsing errors
 * and returns clean JSON instead of crashing or hanging.
 */
const bulkImageUploadMiddleware = (req, res, next) => {
  multerBulkInstance(req, res, (err) => {
    if (err) {
      console.warn('[Bulk Image Upload Multer Error]:', err.message);
      let errorMsg = err.message;
      if (err.code === 'LIMIT_FILE_SIZE') {
        errorMsg = 'File size exceeds the 10 MB per-file limit.';
      } else if (err.code === 'LIMIT_FILE_COUNT') {
        errorMsg = 'Too many files in a single request. Maximum is 10 files per batch.';
      }
      return res.status(400).json({
        success: false,
        message: errorMsg,
        matched: [],
        unmatched: [],
        failed: [{ filename: 'batch', error: errorMsg }]
      });
    }
    next();
  });
};

module.exports = { bulkImageUploadMiddleware };
