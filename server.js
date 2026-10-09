const express = require('express');
const path = require('path');
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
  'https://aruvimembroidery.com',
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

// Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static Files
const customUploadsDir = process.env.UPLOADS_DIR || process.env.PERSISTENT_UPLOADS_DIR;
if (customUploadsDir && fs.existsSync(customUploadsDir)) {
  app.use('/public/uploads', express.static(customUploadsDir));
}
app.use('/public', express.static(path.join(__dirname, 'public')));

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

// App-level global defaults
app.locals.siteSettings = {
  shop_name: 'ARUVI EMBROIDERY STUDIO',
  tagline: 'Where Threads Tell Stories',

  logo_url: '/public/uploads/previews/logo_image-1791088249075-882339975.png',
  mobile_logo_url: '/public/uploads/previews/logo_image-1791088249075-882339975.png',
  favicon_url: '/public/uploads/previews/logo_image-1791088249075-882339975.png',

  contact_email:
    process.env.CONTACT_EMAIL || 'aruviembroidery@gmail.com',

  contact_phone:
    process.env.CONTACT_PHONE || '+91 98765 43210',

  address:
    process.env.SHOP_ADDRESS ||
    'Erode, Tamil Nadu, 638001, India',

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