/**
 * Aruvi Embroidery — Multi-Tier Enterprise Rate Limiting Middleware
 * 
 * Architecture:
 * 1. Strict Limiter: Protects sensitive endpoints (Login, Register, Forgot Password, Checkout, Contact)
 *    - Limit: 10 requests per 15 minutes per IP
 *    - Returns: JSON with status 429, Retry-After header, and detailed code
 * 
 * 2. Admin Upload Limiter: Protects admin chunk upload and bulk tools
 *    - Limit: 5000 requests per 10 minutes
 *    - EXEMPTION: Valid logged-in admin sessions completely skip rate limiting!
 * 
 * 3. Public Pages & API Limiter: Protects general public customer routes
 *    - Limit: 300 requests per 5 minutes per IP
 *    - EXCLUSIONS: Static assets (.png, .jpg, .webp, .css, .js, fonts) & authenticated admin routes
 * 
 * 4. Reset Operations Limiter: Protects database/catalog reset operations
 *    - Limit: 10 requests per 15 minutes
 */

const rateLimit = require('express-rate-limit');

/**
 * Extracts real client IP behind reverse proxies (Hostinger LiteSpeed/Nginx/Cloudflare)
 */
function getClientIp(req) {
  if (req.ip) return req.ip;
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const list = String(forwarded).split(',');
    return list[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Standardized JSON 429 Response Handler
 * Always returns JSON with Retry-After header, never HTML
 */
function createRateLimitHandler(limiterName) {
  return (req, res, next, options) => {
    const windowSeconds = Math.round((options.windowMs || 15 * 60 * 1000) / 1000);
    let retryAfter = 60;

    if (req.rateLimit && req.rateLimit.resetTime) {
      retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000));
    } else {
      retryAfter = windowSeconds;
    }

    // Set standard Retry-After header in seconds
    res.setHeader('Retry-After', String(retryAfter));

    const clientIp = getClientIp(req);
    const userIdentifier = req.user ? (req.user.id || req.user.email) : (req.session?.adminUser || req.session?.userId || 'guest');

    console.warn(`[RateLimit 429 Blocked] [${limiterName}] Route: ${req.method} ${req.originalUrl || req.url} | IP: ${clientIp} | User: ${userIdentifier} | Limit: ${options.limit || options.max} per ${windowSeconds}s | Retry-After: ${retryAfter}s`);

    return res.status(429).json({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      limiter: limiterName,
      error: 'Too many requests. Please wait a moment before trying again.',
      message: typeof options.message === 'string' ? options.message : (options.message?.message || 'Too many requests. Please wait a moment before trying again.'),
      retryAfter: retryAfter,
      retryAfterMs: retryAfter * 1000
    });
  };
}

/**
 * Helper to check if request is an authenticated admin
 */
function isAuthedAdmin(req) {
  if (req.user && req.user.role === 'admin') return true;
  if (req.session && (req.session.adminUser || (req.session.userRole === 'admin'))) return true;
  return false;
}

/**
 * Helper to check if request is for static assets
 */
function isStaticAsset(req) {
  const urlPath = (req.originalUrl || req.path || '').toLowerCase();
  if (urlPath.startsWith('/public') || urlPath.startsWith('/uploads') || urlPath.startsWith('/assets') || urlPath === '/favicon.ico') {
    return true;
  }
  const staticExtRegex = /\.(png|jpe?g|webp|avif|gif|svg|ico|css|js|ttf|otf|woff|woff2|eot|map|txt|xml)$/i;
  return staticExtRegex.test(urlPath);
}

// 1. Strict Limiter (Auth & Sensitive Endpoints: Login, Register, Forgot Password, Checkout, Contact)
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    // Only apply strict limiter to POST actions, not GET view renderings
    if (req.method === 'GET') return true;
    return false;
  },
  handler: createRateLimitHandler('StrictAuthLimiter'),
  message: 'Too many attempts. For security, please wait 15 minutes before trying again.'
});

// 2. Admin Upload Limiter (Chunk init, chunk, complete, match, keep-alive, bulk tools)
const adminUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5000, // 5000 requests per 10 minutes if somehow unauthenticated
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req) => {
    if (req.user && req.user.id) return `admin_${req.user.id}`;
    return getClientIp(req);
  },
  skip: (req) => {
    // EXEMPTION: Valid authenticated admin session completely skips rate limiting!
    if (isAuthedAdmin(req)) return true;
    return false;
  },
  handler: createRateLimitHandler('AdminUploadLimiter'),
  message: 'Admin upload request threshold reached. Please wait a moment.'
});

// 3. Public Pages & API Limiter (General public store requests)
const publicLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300, // 300 requests per 5 minutes per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    // Skip static assets
    if (isStaticAsset(req)) return true;
    // Skip authenticated admin requests
    if (isAuthedAdmin(req) || (req.path && req.path.startsWith('/admin'))) return true;
    // Skip localhost in development mode
    if (process.env.NODE_ENV !== 'production') {
      const ip = getClientIp(req);
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    }
    return false;
  },
  handler: createRateLimitHandler('PublicLimiter'),
  message: 'Too many requests from this IP. Please wait 5 minutes before refreshing.'
});

// 4. Critical Database Reset Limiter
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req) => getClientIp(req),
  handler: createRateLimitHandler('ResetLimiter'),
  message: 'Too many reset requests. Please wait 15 minutes before trying again.'
});

/**
 * Returns diagnostic rate limiter configuration for Admin System Health tool
 */
function getRateLimitStatus(req) {
  const isExempt = req ? isAuthedAdmin(req) : false;
  const clientIp = req ? getClientIp(req) : 'unknown';
  const trustProxySetting = req?.app?.get('trust proxy');

  return {
    trustProxy: {
      enabled: Boolean(trustProxySetting),
      value: trustProxySetting
    },
    clientIp: clientIp,
    adminUpload: {
      isExempt: isExempt,
      limit: 5000,
      windowMs: 10 * 60 * 1000,
      windowMinutes: 10,
      rule: 'Exempt for authenticated admin sessions'
    },
    strictAuth: {
      limit: 10,
      windowMs: 15 * 60 * 1000,
      windowMinutes: 15,
      routes: ['POST /auth/login', 'POST /auth/register', 'POST /auth/forgot-password', 'POST /checkout/*', 'POST /contact']
    },
    publicPages: {
      limit: 300,
      windowMs: 5 * 60 * 1000,
      windowMinutes: 5,
      staticAssetsExempt: true
    }
  };
}

module.exports = {
  getClientIp,
  isAuthedAdmin,
  isStaticAsset,
  strictLimiter,
  adminUploadLimiter,
  publicLimiter,
  resetLimiter,
  getRateLimitStatus
};
