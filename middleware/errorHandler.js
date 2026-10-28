function checkIsAjax(req) {
  if (req.xhr) return true;
  const acceptHeader = String((typeof req.get === 'function' ? req.get('accept') : req.headers['accept']) || req.headers['accept'] || '').toLowerCase();
  if (acceptHeader.includes('json')) return true;

  const requestedWith = String((typeof req.get === 'function' ? req.get('x-requested-with') : req.headers['x-requested-with']) || req.headers['x-requested-with'] || '').toLowerCase();
  if (requestedWith.includes('xmlhttprequest')) return true;

  if (req.query && (req.query.format === 'json' || req.query.ajax === '1' || req.query.is_ajax === '1')) return true;
  if (req.body && (req.body.is_ajax === '1' || req.body.ajax === '1')) return true;

  return false;
}

function errorHandler(err, req, res, next) {
  const isCsrf = err.code === 'EBADCSRF' || (err.message && err.message.toLowerCase().includes('csrf'));
  const statusCode = isCsrf ? 403 : (err.status || err.statusCode || 500);

  const refId = 'err_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const isUploadRoute = req.originalUrl && (
    req.originalUrl.includes('/upload') ||
    req.originalUrl.includes('/bulk-') ||
    req.originalUrl.startsWith('/admin/api/')
  );

  const isAjax = checkIsAjax(req) || isUploadRoute;

  // Log upload request failure with complete diagnostics (excluding credentials)
  if (isUploadRoute) {
    const rawFileName = req.headers['x-file-name'] ? decodeURIComponent(req.headers['x-file-name']) : (req.file ? req.file.originalname : (req.body ? req.body.originalName : 'N/A'));
    const rawFileSize = req.headers['x-file-size'] || (req.file ? req.file.size : (req.body ? req.body.fileSize : 'N/A'));
    const userIdentifier = req.user ? req.user.email : (req.session?.userId ? `UserId:${req.session.userId}` : 'anonymous');
    const csrfStatus = isCsrf ? 'FAILED' : 'PASS';

    console.error(`[Upload Request Failure] [${refId}] Route: ${req.method} ${req.originalUrl} | Status: ${statusCode} | User: ${userIdentifier} | File: "${rawFileName}" (${rawFileSize} bytes) | CSRF: ${csrfStatus} | Error:`, err.stack || err.message);

    return res.status(statusCode).json({
      success: false,
      code: err.code || (isCsrf ? 'EBADCSRF' : (statusCode === 401 ? 'UNAUTHORIZED' : (statusCode === 413 ? 'LIMIT_FILE_SIZE' : 'UPLOAD_ERROR'))),
      message: isCsrf
        ? 'Security token mismatch or expired. Please refresh token and try again.'
        : (err.message || 'An upload processing error occurred.'),
      referenceId: refId,
      stage: err.stage || (isCsrf ? 'CSRF Security Stage' : (statusCode === 401 ? 'Authentication Stage' : (statusCode === 413 ? 'Payload Size Stage' : 'Upload Request Stage'))),
      suggestedAction: isCsrf
        ? 'Refresh your page or re-login if session timed out.'
        : (statusCode === 401
            ? 'Admin session expired. Log in again in another tab, then resume.'
            : (statusCode === 413
                ? 'File exceeds upload limit. Slicing into 1MB chunks prevents this error.'
                : 'Check server logs for database or storage permissions.'))
    });
  }

  console.error(`[Unhandled Error] ${req.method} ${req.originalUrl}:`, err.message || err);

  const title = isCsrf ? 'Security Token Error' : `Error ${statusCode}`;
  const message = isCsrf
    ? 'Your session or security token has expired. Please refresh the page and submit again.'
    : (process.env.NODE_ENV === 'production'
        ? 'Something went wrong. Please try again later.'
        : (err.message || 'An unexpected error occurred.'));

  // Handle Multer upload errors or file format validation errors gracefully
  const isUploadError = err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE' || (err.message && (err.message.includes('Invalid file format') || err.message.includes('file format') || err.message.includes('Unexpected field')));

  if (isUploadError && req.originalUrl && req.originalUrl.startsWith('/admin')) {
    const uploadErrMsg = err.code === 'LIMIT_FILE_SIZE' 
      ? 'File size exceeds maximum limit of 50MB.' 
      : (err.message === 'Unexpected field' 
          ? 'Form upload error: unexpected field uploaded. Please re-try uploading.' 
          : (err.message || 'Invalid file uploaded.'));
    if (isAjax) {
      return res.status(400).json({ success: false, code: 'LIMIT_FILE_SIZE', message: uploadErrMsg, error: uploadErrMsg, referenceId: refId });
    }
    if (req.flash) {
      req.flash('error', uploadErrMsg);
    }
    const backUrl = req.header('Referer') || '/admin/designs';
    return res.redirect(backUrl);
  }

  if (isAjax) {
    return res.status(statusCode).json({
      success: false,
      code: isCsrf ? 'EBADCSRF' : (statusCode === 401 ? 'UNAUTHORIZED' : 'SERVER_ERROR'),
      error: {
        code: isCsrf ? 'CSRF_TOKEN_INVALID' : (statusCode === 401 ? 'UNAUTHORIZED' : 'SERVER_ERROR'),
        message
      },
      message,
      referenceId: refId,
      isCsrf,
      redirectUrl: req.originalUrl.startsWith('/admin') ? '/admin/login' : '/auth/login'
    });
  }

  // HTML Form Submission Error handling: Redirect gracefully instead of rendering full page error
  if (isCsrf) {
    if (req.flash) {
      req.flash('error', req.originalUrl.startsWith('/admin') 
        ? 'Your admin session or security token expired. Please log in again.' 
        : 'Your session expired. Please try submitting again.');
    }
    const targetRedirect = req.originalUrl.startsWith('/admin') ? '/admin/login' : (req.header('Referer') || '/');
    return res.redirect(targetRedirect);
  }

  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const isAdminRoute = req.originalUrl && req.originalUrl.startsWith('/admin');
  const errorId = 'ERR-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  // Log error with stack trace and timestamp
  try {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logLine = `[${new Date().toISOString()}] [${errorId}] ${req.method} ${req.originalUrl}\nError: ${err.message}\nStack: ${err.stack || 'No stack'}\n\n`;
    fs.appendFileSync(path.join(logsDir, 'admin-error.log'), logLine, 'utf8');
  } catch (logErr) {
    console.error('Failed to write to admin-error.log:', logErr.message);
  }

  if (isAdminRoute) {
    const adminMsg = process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred while processing this admin request. The issue has been logged with reference ID.'
      : (err.message || 'An unexpected error occurred.');

    return res.status(statusCode).render('admin/error', {
      title: `Error ${statusCode} - Admin`,
      statusCode,
      message: adminMsg,
      errorId,
      stack: err.stack
    });
  }

  res.status(statusCode).render('pages/error', {
    title,
    statusCode,
    message
  });
}

module.exports = errorHandler;
