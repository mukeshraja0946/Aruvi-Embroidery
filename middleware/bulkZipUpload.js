const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { getUploadsDir } = require('../config/storage');

const allowedZipExts = ['.zip', '.rar', '.dst', '.pes', '.jef', '.exp'];

// Helper to ensure directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

// 1. Storage for chunked uploads
const chunkStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const dir = ensureDir(path.join(getUploadsDir(), 'temp_chunks'));
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const randomHex = crypto.randomBytes(8).toString('hex');
    cb(null, `chunk_raw_${Date.now()}_${randomHex}.part`);
  }
});

const chunkUploadInstance = multer({
  storage: chunkStorage,
  limits: {
    fileSize: 15 * 1024 * 1024 // 15 MB per chunk limit
  }
}).single('chunk');

const bulkZipChunkMiddleware = (req, res, next) => {
  chunkUploadInstance(req, res, (err) => {
    if (err) {
      console.warn('[Bulk ZIP Chunk Multer Error]:', err.message);
      return res.status(400).json({
        success: false,
        message: err.code === 'LIMIT_FILE_SIZE' ? 'Chunk exceeds maximum size (15MB).' : err.message
      });
    }
    next();
  });
};

// 2. Storage for direct small uploads (<= 5MB or max 2 files)
const directStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const dir = ensureDir(path.join(getUploadsDir(), 'temp_zip_uploads'));
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const randomHex = crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `zip_${Date.now()}_${randomHex}${ext || '.zip'}`);
  }
});

const zipFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedZipExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file format for "${file.originalname}". Allowed: .zip, .rar, .dst, .pes, .jef, .exp`));
  }
};

const directUploadInstance = multer({
  storage: directStorage,
  fileFilter: zipFileFilter,
  limits: {
    files: 2, // Max 2 files per direct request
    fileSize: 120 * 1024 * 1024 // 120MB hard limit
  }
}).array('files', 2);

const bulkZipDirectUploadMiddleware = (req, res, next) => {
  directUploadInstance(req, res, (err) => {
    if (err) {
      console.warn('[Bulk ZIP Direct Multer Error]:', err.message);
      let errorMsg = err.message;
      if (err.code === 'LIMIT_FILE_SIZE') {
        errorMsg = 'File size exceeds maximum upload limit.';
      } else if (err.code === 'LIMIT_FILE_COUNT') {
        errorMsg = 'Maximum 2 files allowed per request.';
      }
      return res.status(400).json({
        success: false,
        message: errorMsg,
        matched: [],
        unmatched: [],
        ambiguous: [],
        failed: [{ filename: 'batch', error: errorMsg }]
      });
    }
    next();
  });
};

// 3. Storage for single replacement
const singleReplaceInstance = multer({
  storage: directStorage,
  fileFilter: zipFileFilter,
  limits: {
    fileSize: 120 * 1024 * 1024 // 120MB limit
  }
}).single('file');

const singleZipUploadMiddleware = (req, res, next) => {
  singleReplaceInstance(req, res, (err) => {
    if (err) {
      console.warn('[Single ZIP Replace Multer Error]:', err.message);
      const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
      if (isAjax) {
        return res.status(400).json({ success: false, message: err.message });
      }
      req.flash('error', err.message);
      return res.redirect('back');
    }
    next();
  });
};

module.exports = {
  bulkZipChunkMiddleware,
  bulkZipDirectUploadMiddleware,
  singleZipUploadMiddleware
};
