const crypto = require('crypto');

function csrfProtection(req, res, next) {
  if (!req.session) {
    return next(new Error('Session middleware is required for CSRF protection'));
  }

  // Ensure stable CSRF secret for the active session
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  }

  // Attach req.csrfToken helper method
  req.csrfToken = function() {
    if (!req.session.csrfSecret) {
      req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfSecret;
  };

  // Safe HTTP methods do not mutate state
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Extract token from body, query parameters, or standard security headers
  const token = (req.body && (req.body._csrf || req.body.csrf_token || req.body.securityToken)) ||
                (req.query && (req.query._csrf || req.query.csrf_token || req.query.securityToken)) ||
                req.headers['x-csrf-token'] ||
                req.headers['csrf-token'] ||
                req.headers['x-xsrf-token'] ||
                (typeof req.get === 'function' ? (req.get('x-csrf-token') || req.get('csrf-token') || req.get('x-xsrf-token')) : null);

  // Strict token validation
  if (!token || token !== req.session.csrfSecret) {
    console.warn(`[CSRF Security Alert] ${req.method} ${req.originalUrl} - CSRF token mismatch or missing.`);
    const err = new Error('Security token is invalid or expired. Please refresh the page and submit again.');
    err.status = 403;
    err.code = 'EBADCSRF';
    return next(err);
  }

  next();
}

module.exports = csrfProtection;
