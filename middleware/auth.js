const User = require('../models/User');
const Cart = require('../models/Cart');
const Setting = require('../models/Setting');

async function attachUserAndCart(req, res, next) {
  // Always initialize res.locals defaults to prevent EJS ReferenceError crashes
  res.locals.currentUser = null;
  res.locals.currentPath = req.path || '/';
  res.locals.cartCount = 0;
  res.locals.cart = { items: [], total: 0, count: 0 };
  res.locals.siteSettings = { ...(req.app ? req.app.locals.siteSettings : {}) };
  res.locals.flash = { success: [], error: [], info: [] };
  res.locals.csrfToken = '';

  try {
    // 1. Session customer or admin user
    if (req.session && req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (user && user.is_active) {
        req.user = user;
        res.locals.currentUser = user;
      } else {
        delete req.session.userId;
        req.user = null;
        res.locals.currentUser = null;
      }
    } else {
      req.user = null;
      res.locals.currentUser = null;
    }

    // 2. Session ID for cart tracking
    if (req.session && !req.session.cartSessionId) {
      req.session.cartSessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }

    // 3. Cart Summary
    try {
      const cartSessionId = req.session ? req.session.cartSessionId : null;
      const cart = await Cart.getCart(req.user ? req.user.id : null, cartSessionId);
      res.locals.cart = cart;
      res.locals.cartCount = cart.count || 0;
    } catch (cartErr) {
      console.error('Cart fetch error:', cartErr.message);
    }

    // 4. Global Settings & Flash messages
    try {
      const fetchedSettings = await Setting.getAll();
      if (fetchedSettings && typeof fetchedSettings === 'object') {
        res.locals.siteSettings = {
          ...(req.app ? req.app.locals.siteSettings : {}),
          ...fetchedSettings
        };
        if (req.app) {
          req.app.locals.siteSettings = res.locals.siteSettings;
        }
      }
    } catch (settingErr) {
      console.error('Setting fetch error:', settingErr.message);
    }

    // Ensure settings alias points to siteSettings for seamless access across all partials & views
    res.locals.settings = res.locals.siteSettings;

    if (req.flash) {
      res.locals.flash = {
        success: req.flash('success') || [],
        error: req.flash('error') || [],
        info: req.flash('info') || [],
        account_not_found: req.flash('account_not_found') || false,
        account_email: req.flash('account_email') || ''
      };
    }

    // 5. CSRF Token generator for templates
    if (typeof req.csrfToken === 'function') {
      try {
        res.locals.csrfToken = req.csrfToken();
      } catch (e) {
        res.locals.csrfToken = '';
      }
    }

    res.locals.currentPath = req.path || '/';
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    next();
  }
}

function isAuthenticated(req, res, next) {
  if (req.user) {
    return next();
  }
  req.flash('error', 'Please log in to access your account.');
  if (req.session) {
    req.session.returnTo = req.originalUrl;
  }
  return res.redirect('/auth/login');
}

function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  const isAjax = req.xhr || 
    (req.headers.accept && req.headers.accept.includes('json')) || 
    (req.headers['x-requested-with'] && req.headers['x-requested-with'].toLowerCase() === 'xmlhttprequest') ||
    (req.query && req.query.format === 'json');

  if (isAjax) {
    return res.status(401).json({ 
      success: false, 
      message: 'Admin session expired or access denied. Please log in again.',
      redirectUrl: '/admin/login'
    });
  }

  req.flash('error', 'Access denied. Authorized admin access required.');
  return res.redirect('/admin/login');
}

module.exports = {
  attachUserAndCart,
  isAuthenticated,
  isAdmin
};
