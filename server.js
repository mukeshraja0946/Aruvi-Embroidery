const serverStartTime = Date.now();

// ---------------------------------------------------------------------------
// Node.js Deprecation Fix [DEP0044]: util.isArray -> Array.isArray
// Polyfills deprecated util.isArray used by legacy packages (connect-flash v0.1.1)
// ---------------------------------------------------------------------------
const util = require('util');
if (typeof util.isArray === 'function') {
  util.isArray = Array.isArray;
}

// ---------------------------------------------------------------------------
// Process-Level Crash Protection (Hostinger Business Resilient Operation)
// Keeps the Node.js process alive for recoverable errors and logs with reference IDs
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  const refId = `EXC_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  console.error(`[${new Date().toISOString()}] [CRITICAL UNCAUGHT EXCEPTION] [Ref: ${refId}]:`, err.stack || err);
});

process.on('unhandledRejection', (reason) => {
  const refId = `REJ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  console.error(`[${new Date().toISOString()}] [UNHANDLED PROMISE REJECTION] [Ref: ${refId}]:`, reason);
});

const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

dotenv.config();

const previewService = require('./services/previewService');

const app = express();

// Degraded mode tracking (never crashes the server)
app.locals.isDegraded = false;
app.locals.degradedReasons = [];

// Lightweight health check endpoint for Hostinger / uptime monitoring (zero DB/storage work)
app.get('/healthz', (req, res) => {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    degraded: Boolean(app.locals.isDegraded),
    degradedReasons: app.locals.degradedReasons || [],
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
    },
    timestamp: new Date().toISOString()
  });
});

// Request timeout protection (25s) to prevent slow requests from hanging the process
app.use((req, res, next) => {
  const isHeavy = req.path.includes('/upload-chunk') || req.path.includes('/backup');
  const timeoutMs = isHeavy ? 120000 : 25000;

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.warn(`[Request Timeout Warning] Request exceeded ${timeoutMs / 1000}s timeout: ${req.method} ${req.originalUrl}`);
      res.status(504).send('<!DOCTYPE html><html><head><title>Request Timeout</title><style>body{font-family:sans-serif;padding:3rem;text-align:center;color:#333;}</style></head><body><h1>504 Request Timeout</h1><p>The server took too long to process your request. Please try again.</p><p><a href="javascript:location.reload()">Reload Page</a> | <a href="/">Return Home</a></p></body></html>');
    }
  }, timeoutMs);

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

// Hostinger Business Plan RAM Watcher: Checks RSS against 512MB limit every 60s
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '512', 10);
setInterval(() => {
  try {
    const mem = process.memoryUsage();
    const rssMb = mem.rss / 1024 / 1024;
    if (rssMb > (MEMORY_LIMIT_MB * 0.70)) {
      console.warn(`[Memory Alert] High RAM usage: RSS ${Math.round(rssMb)}MB (${Math.round((rssMb / MEMORY_LIMIT_MB) * 100)}% of ${MEMORY_LIMIT_MB}MB limit). Heap used: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
    }
  } catch (_) {}
}, 60000).unref();

// Enable trust proxy for production HTTPS reverse proxies (Nginx, Cloudflare, Render, Cpanel)
app.set('trust proxy', 1);

// Use Render's PORT in production, otherwise 3000 locally
const PORT = process.env.PORT || 3000;

// Security Headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow CDNs for Google Fonts, FontAwesome, Razorpay
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// CORS configuration supporting credentials across production domains
const allowedOrigins = [
  process.env.APP_URL,
  process.env.SITE_URL,
  'https://aruviembroidery.com',
  'http://localhost:3000'
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.some(o => origin.startsWith(o)) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true
  })
);

// Body Parsing (allow up to 50MB for batch payloads, raw 10MB stream for binary upload chunks)
app.use('/admin/api/upload/chunk', express.raw({ type: 'application/octet-stream', limit: '10mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Persistent Storage & Static Files
const storage = require('./config/storage');
storage.initStorage();
const initialStorageStatus = storage.validateStorageConfiguration();
app.locals.storageAlert = {
  isSafe: !initialStorageStatus.isBlocked,
  isBlocked: initialStorageStatus.isBlocked,
  warningMessage: initialStorageStatus.warningMessage,
  uploadsDir: initialStorageStatus.uploadsDir,
  driver: initialStorageStatus.driver
};
if (initialStorageStatus.isBlocked) {
  app.locals.isDegraded = true;
  app.locals.degradedReasons.push(`Storage unsafe or blocked: ${initialStorageStatus.warningMessage || 'UPLOAD_DIR inside deploy folder'}`);
}

// Strict Security: Block unauthenticated static access to paid design archives, raw uploads & private files
// Paid design files must be downloaded ONLY through authenticated customer/user download routes
const blockedStaticPaths = [
  '/public/uploads/designs', '/uploads/designs',
  '/public/uploads/raw', '/uploads/raw',
  '/public/uploads/originals', '/uploads/originals',
  '/public/uploads/private', '/uploads/private',
  '/public/uploads/private/originals', '/uploads/private/originals',
  '/private_uploads', '/public/uploads/private_designs',
  '/storage_private', '/public/storage_private',
  '/design-files', '/public/design-files',
  '/raw_uploads', '/public/raw_uploads'
];

app.use(blockedStaticPaths, (req, res) => {
  res.status(403).json({ error: 'Access forbidden. Raw uploads and paid machine archives can only be downloaded via authenticated routes.' });
});

// Block machine file extensions (.zip, .dst, .pes, etc.) from direct public static requests
app.use(['/public', '/uploads', '/public/uploads'], (req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  const machineExts = ['.zip', '.dst', '.pes', '.jef', '.exp', '.xxx', '.vp3', '.hus', '.sew', '.pec', '.rar', '.7z'];
  if (machineExts.includes(ext)) {
    return res.status(403).json({ error: 'Access forbidden. Machine files must be downloaded through authenticated customer download routes.' });
  }
  next();
});

// Serve preview images and public uploads from persistent storage (long cache for assets)
const staticCacheOptions = { maxAge: '7d', index: false };
app.use('/public/uploads/previews', express.static(storage.getPreviewsDir(), staticCacheOptions));
app.use('/uploads/previews', express.static(storage.getPreviewsDir(), staticCacheOptions));
app.use('/public/uploads/branding', express.static(storage.getBrandingDir(), staticCacheOptions));
app.use('/uploads/branding', express.static(storage.getBrandingDir(), staticCacheOptions));
app.use('/public/uploads/banners', express.static(storage.getBannersDir(), staticCacheOptions));
app.use('/uploads/banners', express.static(storage.getBannersDir(), staticCacheOptions));
app.use('/public/uploads', express.static(storage.getPublicDir(), staticCacheOptions));
app.use('/uploads', express.static(storage.getPublicDir(), staticCacheOptions));
app.use('/public/uploads', express.static(storage.getUploadsDir(), staticCacheOptions));
app.use('/uploads', express.static(storage.getUploadsDir(), staticCacheOptions));

// Fallback to project default public/uploads if custom persistent directory is configured
if (path.resolve(storage.getUploadsDir()) !== path.resolve(storage.defaultUploadsDir)) {
  app.use('/public/uploads/previews', express.static(path.join(storage.defaultUploadsDir, 'previews'), staticCacheOptions));
  app.use('/uploads/previews', express.static(path.join(storage.defaultUploadsDir, 'previews'), staticCacheOptions));
  app.use('/public/uploads', express.static(storage.defaultUploadsDir, staticCacheOptions));
  app.use('/uploads', express.static(storage.defaultUploadsDir, staticCacheOptions));
}

app.use('/public', express.static(path.join(__dirname, 'public')));

// Universal preview image resolver (locates preview images across persistent and fallback storage)
const serveUploadedPreview = (req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg', '.ico'].includes(ext)) {
    const resolved = storage.resolveFilePath(req.path) || storage.resolveFilePath(path.join('previews', req.path));
    if (resolved && fs.existsSync(resolved)) {
      return res.sendFile(resolved);
    }
  }
  next();
};

app.use('/public/uploads/previews', serveUploadedPreview);
app.use('/uploads/previews', serveUploadedPreview);
app.use('/public/uploads', serveUploadedPreview);
app.use('/uploads', serveUploadedPreview);

// Session Management with persistent express-mysql-session (prevents worker reload session drops)
const MySQLStore = require('express-mysql-session')(session);

let sessionStore = null;
try {
  const sessionDbOptions = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aruvi_embroidery',
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 mins
    expiration: 7 * 24 * 60 * 60 * 1000, // 7 days
    connectTimeout: 5000,
    connectionLimit: 3,
    endConnectionOnClose: true
  };

  const dbUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.CLEARDB_DATABASE_URL || process.env.JAWSDB_URL;
  if (dbUrl) {
    try {
      const parsedUrl = new URL(dbUrl);
      sessionDbOptions.host = parsedUrl.hostname || sessionDbOptions.host;
      sessionDbOptions.port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : sessionDbOptions.port;
      sessionDbOptions.user = decodeURIComponent(parsedUrl.username || sessionDbOptions.user);
      sessionDbOptions.password = decodeURIComponent(parsedUrl.password || sessionDbOptions.password);
      sessionDbOptions.database = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : sessionDbOptions.database;
    } catch (_) {}
  }

  sessionStore = new MySQLStore(sessionDbOptions);
  sessionStore.on('error', function (storeErr) {
    console.warn('[Session Store Warning] MySQL session store notice (operating with memory fallback):', storeErr.message);
  });
} catch (storeInitErr) {
  console.warn('[Session Store Warning] MySQL session store initialization fallback to memory:', storeInitErr.message);
}

// Resilient Session Store: delegates to MySQL when connected, gracefully falls back to memory without crashing
const db = require('./config/db');
class SafeStore extends session.Store {
  constructor() {
    super();
    this.memoryStore = new session.MemoryStore();
  }
  get(sid, fn) {
    if (sessionStore && db.isConnected()) {
      try {
        sessionStore.get(sid, (err, sess) => {
          if (err) return this.memoryStore.get(sid, fn);
          return fn(null, sess);
        });
      } catch (_) {
        this.memoryStore.get(sid, fn);
      }
    } else {
      this.memoryStore.get(sid, fn);
    }
  }
  set(sid, sess, fn) {
    this.memoryStore.set(sid, sess, () => {});
    if (sessionStore && db.isConnected()) {
      try {
        sessionStore.set(sid, sess, (err) => {
          if (fn) fn(err);
        });
      } catch (_) {
        if (fn) fn();
      }
    } else if (fn) {
      fn();
    }
  }
  destroy(sid, fn) {
    this.memoryStore.destroy(sid, () => {});
    if (sessionStore && db.isConnected()) {
      try {
        sessionStore.destroy(sid, fn);
      } catch (_) {
        if (fn) fn();
      }
    } else if (fn) {
      fn();
    }
  }
  touch(sid, sess, fn) {
    this.memoryStore.touch(sid, sess, () => {});
    if (sessionStore && db.isConnected() && typeof sessionStore.touch === 'function') {
      try {
        sessionStore.touch(sid, sess, fn);
      } catch (_) {
        if (fn) fn();
      }
    } else if (fn) {
      fn();
    }
  }
}
const safeStore = new SafeStore();

app.use(
  session({
    store: safeStore,
    secret:
      process.env.SESSION_SECRET ||
      'aruvi_embroidery_secret_stitch_key',
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    }
  })
);

// Flash Messages
app.use(flash());

// CSRF Protection
const csrfProtection = require('./middleware/csrf');
app.use(csrfProtection);

// View Engine Setup (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// App-level global defaults (always falls back to committed brand assets if custom upload is missing)
app.locals.siteSettings = {
  shop_name: 'ARUVI EMBROIDERY STUDIO',
  tagline: 'Where Threads Tell Stories',

  logo_url: storage.resolveBrandAsset('logo', null),
  mobile_logo_url: storage.resolveBrandAsset('mobile_logo', null),
  favicon_url: storage.resolveBrandAsset('favicon', null),
  hero_image: storage.resolveBrandAsset('hero_image', null),

  contact_email:
    process.env.CONTACT_EMAIL || 'aruviembroidery@gmail.com',

  contact_phone: process.env.CONTACT_PHONE || '',

  address: process.env.SHOP_ADDRESS || '',

  currency_symbol: '₹',

  announcement_bar:
    'Premium Machine Embroidery Designs — DST, PES, JEF, EXP & More | Instant Download',

  facebook_url:
    process.env.FACEBOOK_URL ||
    'https://facebook.com/aruviembroidery',

  instagram_url:
    process.env.INSTAGRAM_URL ||
    'https://instagram.com/aruviembroidery',

  pinterest_url:
    process.env.PINTEREST_URL ||
    'https://pinterest.com/aruviembroidery',

  youtube_url:
    process.env.YOUTUBE_URL ||
    'https://youtube.com/aruviembroidery',

  // UPI
  upi_id: process.env.UPI_ID || '',
  upiId: process.env.UPI_ID || '',

  upi_name:
    process.env.UPI_NAME || 'ARUVI EMBROIDERY STUDIO',

  upiName:
    process.env.UPI_NAME || 'ARUVI EMBROIDERY STUDIO',

  upiMerchantName:
    process.env.UPI_NAME || 'ARUVI EMBROIDERY STUDIO',

  twitter_url:
    process.env.TWITTER_URL || '',

  show_design_reviews: '0',
  show_design_related: '0'
};

// Global defaults
app.locals.currentUser = null;
app.locals.currentPath = '';
app.locals.cartCount = 0;
app.locals.flash = {
  success: [],
  error: [],
  info: []
};
app.locals.csrfToken = '';
app.locals.getPrimaryPreview = (d) => previewService.getPrimaryPreview(d);

// Custom Middleware
// Attach user, cart, flash & global settings
const { attachUserAndCart } = require('./middleware/auth');
app.use(attachUserAndCart);

// Public Pages & API Rate Limiter (moderate 300 per 5 min, static assets & admin routes excluded)
const { publicLimiter } = require('./middleware/rateLimiters');
app.use(publicLimiter);

// Routes
const indexRoutes = require('./routes/indexRoutes');
const shopRoutes = require('./routes/shopRoutes');
const cartRoutes = require('./routes/cartRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const adminRoutes = require('./routes/adminRoutes');

app.use('/', indexRoutes);
app.use('/', shopRoutes);
app.use('/', cartRoutes);
app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', checkoutRoutes);
app.use('/', adminRoutes);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).render('pages/error', {
    title: '404 - Page Not Found',
    statusCode: 404,
    message:
      'The requested page or embroidery design could not be found.'
  });
});

// Global Error Handler
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Global Schema Alert state for Admin Dashboard & System Health
app.locals.schemaAlert = { isHealthy: true, missingCount: 0, missingSummary: '' };

function checkRequiredEnvVars() {
  const missing = [];
  if (!process.env.DB_NAME && !process.env.DATABASE_URL && !process.env.MYSQL_URL) missing.push('DB_NAME (or DATABASE_URL)');
  if (!process.env.DB_USER && !process.env.DATABASE_URL && !process.env.MYSQL_URL) missing.push('DB_USER');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET (using fallback default)');
  if (!process.env.UPLOAD_DIR && process.env.NODE_ENV === 'production') missing.push('UPLOAD_DIR (using auto-detected or fallback)');
  if (!process.env.RAZORPAY_KEY_ID) missing.push('RAZORPAY_KEY_ID (payments in test/mock mode)');
  if (!process.env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');

  if (missing.length > 0) {
    console.warn('====================================================');
    console.warn('⚠️ [ENVIRONMENT VARIABLES NOTICE]');
    console.warn('   The following recommended environment variables are not set:');
    missing.forEach(v => console.warn(`   - ${v}`));
    console.warn('   The application will continue in resilient fallback mode.');
    console.warn('====================================================');
  }
}

let hasInitializedDatabase = false;
let databaseServerVersion = 'Unknown';

async function initializeDatabaseAndSchema() {
  if (hasInitializedDatabase) return;
  hasInitializedDatabase = true;

  // 1. Automatically apply any pending database migrations before accepting requests
  try {
    const { runPendingMigrations } = require('./services/migrationRunner');
    const migResult = await runPendingMigrations({ silent: false });
    if (migResult && migResult.dbServerVersion) {
      databaseServerVersion = migResult.dbServerVersion;
    }
    if (migResult && migResult.failedCount > 0) {
      app.locals.isDegraded = true;
      app.locals.degradedReasons.push(`Database migrations had ${migResult.failedCount} issue(s)`);
    }
  } catch (migErr) {
    const { formatErrorMessage } = require('./services/migrationRunner');
    const cleanMsg = formatErrorMessage(migErr);
    console.error('====================================================');
    console.error('❌ [DATABASE MIGRATION STARTUP ERROR]');
    console.error(`   Message: ${cleanMsg}`);
    console.error('   Action: Verify DB credentials in hPanel or run "npm run migrate"');
    console.error('====================================================');
    app.locals.isDegraded = true;
    app.locals.degradedReasons.push(`Database connection / migration error: ${cleanMsg}`);
  }

  // 2. Schema Safety Check: compare required columns against information_schema
  try {
    const { checkSchemaSafetyOnStartup } = require('./services/schemaHealthService');
    const schemaStatus = await checkSchemaSafetyOnStartup();
    app.locals.schemaAlert = schemaStatus;
    if (schemaStatus && !schemaStatus.isHealthy) {
      app.locals.isDegraded = true;
      app.locals.degradedReasons.push(`Database missing columns: ${schemaStatus.missingSummary || 'See System Health'}`);
    }
  } catch (schemaErr) {
    console.warn('[Startup Schema Check Warning]:', schemaErr.message);
  }

  // 3. Run auto-repairs for slugs and stitch counts
  try {
    const Design = require('./models/Design');
    if (typeof Design.ensureDatabaseColumns === 'function') await Design.ensureDatabaseColumns();
    if (typeof Design.repairInvalidDatabaseSlugs === 'function') await Design.repairInvalidDatabaseSlugs();
    if (typeof Design.repairExistingStitchCounts === 'function') await Design.repairExistingStitchCounts();
  } catch (err) {
    console.warn('[Startup Repair Notice]:', err.message);
  }
}

// Start Server: binds port immediately on 0.0.0.0 to satisfy Hostinger proxy health checks
function startServer() {
  const listenStartTime = serverStartTime;
  checkRequiredEnvVars();

  const server = app.listen(PORT, '0.0.0.0', () => {
    const elapsed = Date.now() - listenStartTime;
    const storageStatus = storage.getStorageStatus();
    const sessionType = (sessionStore && db.isConnected()) ? 'express-mysql-session' : 'SafeStore (resilient)';

    console.log('====================================================');
    console.log(`🌸 Aruvi Embroidery Web App running on port ${PORT}`);
    console.log(`⚡ SERVER STARTED on port ${PORT} in ${elapsed} ms, degraded=${Boolean(app.locals.isDegraded)}`);
    console.log(`🌐 Server URL: http://0.0.0.0:${PORT}`);
    console.log(`📦 Storage Driver: ${storageStatus.driver.toUpperCase()}`);
    console.log(`📁 UPLOAD_DIR: ${storageStatus.uploadsDir}, writable: ${storageStatus.isWritable ? 'yes' : 'no'}`);
    console.log(`🔐 Session Store: ${sessionType}`);
    console.log('====================================================');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server Fatal Error] Port ${PORT} is already in use by another process.`);
    } else {
      console.error('[Server Fatal Error]:', err);
    }
  });

  // Background initialization runs asynchronously without blocking HTTP port binding
  initializeDatabaseAndSchema().catch((err) => {
    console.warn('[Startup Notice] Background DB/Schema initialization notice:', err.message);
  });

  return server;
}

// Passenger or standalone startup check
if (typeof PhusionPassenger !== 'undefined') {
  checkRequiredEnvVars();
  app.listen('passenger', () => {
    console.log(`⚡ SERVER STARTED on Phusion Passenger, degraded=${Boolean(app.locals.isDegraded)}`);
  });
  initializeDatabaseAndSchema().catch((err) => {
    console.warn('[Passenger Startup Notice] DB/Schema initialization notice:', err.message);
  });
} else if (require.main === module) {
  startServer();
}

module.exports = app;