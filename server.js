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

const app = express();

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

// Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // 2000 requests per IP
  skip: (req) =>
    req.ip === '127.0.0.1' ||
    req.ip === '::1' ||
    req.ip === '::ffff:127.0.0.1' ||
    process.env.NODE_ENV !== 'production',
  message: 'Too many requests from this IP, please try again after 15 minutes.'
});

app.use(limiter);

// Body Parsing (allow up to 50MB for batch payloads)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Persistent Storage & Static Files
const storage = require('./config/storage');
storage.initStorage();
storage.validateStorageConfiguration();

// Strict Security: Block unauthenticated static access to paid design archives & private uploads
// Paid design files must be downloaded ONLY through authenticated customer/user download routes
app.use(['/public/uploads/designs', '/uploads/designs', '/private_uploads', '/public/uploads/private_designs'], (req, res) => {
  res.status(403).json({ error: 'Access forbidden. Paid design archives can only be downloaded via authenticated routes.' });
});

// Serve preview images and public uploads from persistent storage
app.use('/public/uploads/previews', express.static(storage.getPreviewsDir()));
app.use('/uploads/previews', express.static(storage.getPreviewsDir()));
app.use('/public/uploads', express.static(storage.getUploadsDir()));
app.use('/uploads', express.static(storage.getUploadsDir()));

// Fallback to project default public/uploads if custom persistent directory is configured
if (path.resolve(storage.getUploadsDir()) !== path.resolve(storage.defaultUploadsDir)) {
  app.use('/public/uploads/previews', express.static(path.join(storage.defaultUploadsDir, 'previews')));
  app.use('/uploads/previews', express.static(path.join(storage.defaultUploadsDir, 'previews')));
  app.use('/public/uploads', express.static(storage.defaultUploadsDir));
  app.use('/uploads', express.static(storage.defaultUploadsDir));
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

// Session Management
app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      'aruvi_embroidery_secret_stitch_key',
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
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
    process.env.TWITTER_URL || ''
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

// Custom Middleware
// Attach user, cart, flash & global settings
const { attachUserAndCart } = require('./middleware/auth');
app.use(attachUserAndCart);

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

// Start Server
// 0.0.0.0 is required so Render can access the application
async function startServer() {
  // Automatically apply any pending database migrations before accepting requests
  try {
    const { runPendingMigrations } = require('./services/migrationRunner');
    await runPendingMigrations({ silent: false });
  } catch (migErr) {
    console.error('❌ [DATABASE MIGRATION STARTUP ERROR]:', migErr.message);
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log('====================================================');
    console.log(`🌸 Aruvi Embroidery Web App running on port ${PORT}`);
    console.log('📌 Tagline: "Where Threads Tell Stories"');
    console.log(`🌐 Server URL: http://0.0.0.0:${PORT}`);
    console.log('====================================================');

    try {
      const Design = require('./models/Design');
      await Design.repairInvalidDatabaseSlugs();
    } catch (err) {
      console.warn('[Startup Repair] Slug repair warning:', err.message);
    }
  });
}

startServer();