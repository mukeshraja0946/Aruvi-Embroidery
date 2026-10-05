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
const PORT = process.env.PORT || 3000;

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow CDNs for Google Fonts, FontAwesome, Razorpay
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS
app.use(cors());

// Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // 2000 requests per IP
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1' || process.env.NODE_ENV !== 'production',
  message: 'Too many requests from this IP, please try again after 15 minutes.'
});
app.use(limiter);

// Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static Files (public directory)
app.use('/public', express.static(path.join(__dirname, 'public')));

// Session Management
app.use(session({
  secret: process.env.SESSION_SECRET || 'aruvi_embroidery_secret_stitch_key',
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Flash Messages
app.use(flash());

// CSRF Protection
const csrfProtection = require('./middleware/csrf');
app.use(csrfProtection);

// View Engine Setup (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// App-level global defaults for all EJS templates (Baseline safety against ReferenceErrors)
app.locals.siteSettings = {
  shop_name: 'ARUVI EMBROIDERY STUDIO',
  tagline: 'Where Threads Tell Stories',
  logo_url: '/public/images/logo.jpg',
  mobile_logo_url: '/public/images/logo.jpg',
  favicon_url: '/public/images/logo.jpg',
  contact_email: 'aruviembroidery@gmail.com',
  contact_phone: '+91 98765 43210',
  address: 'Erode, Tamil Nadu, 638001, India',
  currency_symbol: '₹',
  announcement_bar: 'Premium Machine Embroidery Designs — DST, PES, JEF, EXP & More | Instant Download',
  facebook_url: 'https://facebook.com/aruviembroidery',
  instagram_url: 'https://instagram.com/aruviembroidery',
  linkedin_url: 'https://linkedin.com/company/aruviembroidery',
  youtube_url: 'https://youtube.com/aruviembroidery',
  upi_id: 'aruviembroidery@upi',
  upiId: 'aruviembroidery@upi',
  upi_name: 'ARUVI EMBROIDERY STUDIO',
  upiName: 'ARUVI EMBROIDERY STUDIO',
  upiMerchantName: 'ARUVI EMBROIDERY STUDIO',
  bank_name: 'State Bank of India',
  bankName: 'State Bank of India',
  account_number: '39849201928',
  accountNumber: '39849201928',
  ifsc_code: 'SBIN0001234',
  ifscCode: 'SBIN0001234',
  account_holder: 'ARUVI EMBROIDERY STUDIO',
  accountHolder: 'ARUVI EMBROIDERY STUDIO',
  accountHolderName: 'ARUVI EMBROIDERY STUDIO',
  pinterest_url: '',
  twitter_url: ''
};
app.locals.currentUser = null;
app.locals.currentPath = '';
app.locals.cartCount = 0;
app.locals.flash = { success: [], error: [], info: [] };
app.locals.csrfToken = '';

// Custom Middleware: Attach user, cart, flash & global settings
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
    message: 'The requested page or embroidery design could not be found.'
  });
});

// Global Error Handler
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🌸 Aruvi Embroidery Web App running on port ${PORT}`);
  console.log(`📌 Tagline: "Where Threads Tell Stories"`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
