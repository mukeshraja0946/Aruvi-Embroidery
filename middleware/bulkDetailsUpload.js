const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Dedicated temp storage for details files
const tempDir = path.join(os.tmpdir(), 'aruvi-details-import');
if (!fs.existsSync(tempDir)) {
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (e) {
    // fallback
  }
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, fs.existsSync(tempDir) ? tempDir : os.tmpdir());
  },
  filename: function (req, file, cb) {
    const randomHex = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `details-${Date.now()}-${randomHex}${ext || '.txt'}`);
  }
});

const allowedExts = ['.xlsx', '.xls', '.docx', '.doc', '.pdf', '.txt'];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (allowedExts.includes(ext)) {
    return cb(null, true);
  }
  return cb(new Error(`Invalid file format "${ext}". Only .xlsx, .xls, .docx, .pdf, and .txt files are supported.`));
};

const multerInstance = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB limit
  }
});

const bulkDetailsUploadMiddleware = (req, res, next) => {
  multerInstance.single('details_file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Uploaded file is too large. Maximum allowed size is 25 MB.'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid file uploaded. Supported formats: .xlsx, .xls, .docx, .pdf, and .txt.'
      });
    }

    if (!req.file && req.files) {
      req.file = Array.isArray(req.files) ? req.files[0] : Object.values(req.files).flat()[0];
    }

    next();
  });
};

module.exports = {
  bulkDetailsUploadMiddleware
};
