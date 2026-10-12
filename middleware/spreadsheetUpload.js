const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Dedicated temp storage for spreadsheets (auto-cleaned after parsing)
const tempDir = path.join(os.tmpdir(), 'aruvi-spreadsheets');
if (!fs.existsSync(tempDir)) {
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (e) {
    // Fallback to os.tmpdir if creation fails
  }
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, fs.existsSync(tempDir) ? tempDir : os.tmpdir());
  },
  filename: function (req, file, cb) {
    const randomHex = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `import-${Date.now()}-${randomHex}${ext || '.xlsx'}`);
  }
});

const allowedSpreadsheetExts = ['.xlsx', '.xls', '.csv'];
const allowedSpreadsheetMimes = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msexcel',
  'application/x-msexcel',
  'application/x-ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'text/x-csv',
  'application/x-csv',
  'application/octet-stream' // Required for some browsers sending octet-stream for .xlsx or .csv
];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  const isExtAllowed = allowedSpreadsheetExts.includes(ext);
  const isMimeAllowed = allowedSpreadsheetMimes.includes(mime);

  if (isExtAllowed && (isMimeAllowed || !mime)) {
    return cb(null, true);
  }

  return cb(new Error('Invalid file format. Only spreadsheet files (.xlsx, .xls, .csv) are allowed.'));
};

const multerInstance = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB maximum
  }
});

// Middleware wrapper that returns clean JSON on error without crashing or 500
const spreadsheetUploadMiddleware = (req, res, next) => {
  multerInstance.single('spreadsheet')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Spreadsheet file is too large. Maximum allowed size is 10 MB.'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid spreadsheet file. Only .xlsx, .xls, and .csv files are supported.'
      });
    }

    // Also support multipart/form-data with fieldname 'file' if sent
    if (!req.file && req.files) {
      req.file = Array.isArray(req.files) ? req.files[0] : Object.values(req.files).flat()[0];
    }

    next();
  });
};

module.exports = {
  spreadsheetUploadMiddleware,
  multerInstance
};
