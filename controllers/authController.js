const User = require('../models/User');
const Cart = require('../models/Cart');
const { validationResult } = require('express-validator');

function getSafeReturnUrl(target) {
  if (!target || typeof target !== 'string') return null;
  const trimmed = target.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return trimmed;
  }
  return null;
}

exports.getLogin = (req, res) => {
  if (req.user) return res.redirect('/user/dashboard');
  if (req.query.returnTo) {
    const safe = getSafeReturnUrl(req.query.returnTo);
    if (safe && req.session) req.session.returnTo = safe;
  }
  res.render('auth/login', {
    title: 'Customer Login - Aruvi Embroidery',
    returnTo: getSafeReturnUrl(req.query.returnTo || (req.session ? req.session.returnTo : null))
  });
};

exports.postLogin = async (req, res, next) => {
  const acceptHeader = (req.get && req.get('accept')) || req.headers.accept || '';
  const xhrHeader = (req.get && req.get('x-requested-with')) || req.headers['x-requested-with'] || '';
  const isAjax = req.xhr || 
                 xhrHeader.toLowerCase() === 'xmlhttprequest' ||
                 acceptHeader.includes('json') || 
                 (req.body && (req.body._ajax || req.body.ajax)) || 
                 req.query.format === 'json';
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      if (isAjax) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
      }
      req.flash('error', 'Email and password are required.');
      return res.redirect('/auth/login');
    }

    const user = await User.findByEmail(email);

    if (!user) {
      if (isAjax) {
        return res.status(400).json({
          success: false,
          code: 'ACCOUNT_NOT_FOUND',
          message: 'No account found with this email. Please create an account.'
        });
      }
      req.flash('account_not_found', true);
      req.flash('account_email', email);
      return res.redirect('/auth/login');
    }

    if (!user.is_active) {
      if (isAjax) {
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Your account has been deactivated. Please contact support.'
        });
      }
      req.flash('error', 'Your account has been deactivated. Please contact support.');
      return res.redirect('/auth/login');
    }

    const isValid = await User.verifyPassword(password, user.password_hash);
    if (!isValid) {
      if (isAjax) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PASSWORD',
          message: 'Incorrect password. Please try again.'
        });
      }
      req.flash('error', 'Incorrect password. Please try again.');
      return res.redirect('/auth/login');
    }

    req.session.userId = user.id;

    // Merge guest session cart into user account
    if (req.session && req.session.cartSessionId) {
      await Cart.mergeCart(user.id, req.session.cartSessionId);
    }
    if (req.session && req.session.pendingBuyNow) {
      await Cart.addItem(user.id, null, req.session.pendingBuyNow);
      delete req.session.pendingBuyNow;
    }

    const returnTo = user.role === 'admin' 
      ? '/admin' 
      : (getSafeReturnUrl(req.body.returnTo || req.query.returnTo || req.session.returnTo) || '/user/dashboard');
    delete req.session.returnTo;

    if (isAjax) {
      return res.json({
        success: true,
        message: `Welcome back, ${user.full_name}!`,
        redirect: returnTo
      });
    }

    if (user.role === 'admin') {
      req.flash('success', 'Logged in to Admin Panel.');
      return res.redirect('/admin');
    }

    req.flash('success', `Welcome back, ${user.full_name}!`);
    res.redirect(returnTo);
  } catch (err) {
    console.error('postLogin error:', err);
    if (isAjax) {
      return res.status(500).json({
        success: false,
        message: err.message || 'An error occurred during authentication.'
      });
    }
    next(err);
  }
};

exports.getRegister = (req, res) => {
  if (req.user) return res.redirect('/user/dashboard');
  if (req.query.returnTo) {
    const safe = getSafeReturnUrl(req.query.returnTo);
    if (safe && req.session) req.session.returnTo = safe;
  }
  res.render('auth/register', {
    title: 'Create Account - Aruvi Embroidery',
    returnTo: getSafeReturnUrl(req.query.returnTo || (req.session ? req.session.returnTo : null))
  });
};

exports.postRegister = async (req, res, next) => {
  try {
    const { full_name, email, password, confirm_password, phone } = req.body;

    if (password !== confirm_password) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('/auth/register');
    }

    const existing = await User.findByEmail(email);
    if (existing) {
      req.flash('error', 'An account with this email already exists.');
      return res.redirect('/auth/register');
    }

    const userId = await User.create({
      full_name,
      email,
      password,
      phone
    });

    req.session.userId = userId;

    // Merge guest session cart into user account
    if (req.session && req.session.cartSessionId) {
      await Cart.mergeCart(userId, req.session.cartSessionId);
    }
    if (req.session && req.session.pendingBuyNow) {
      await Cart.addItem(userId, null, req.session.pendingBuyNow);
      delete req.session.pendingBuyNow;
    }

    const returnTo = getSafeReturnUrl(req.body.returnTo || req.query.returnTo || req.session.returnTo) || '/user/dashboard';
    delete req.session.returnTo;

    req.flash('success', 'Registration successful! Welcome to Aruvi Embroidery.');
    res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
};

exports.getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Forgot Password - Aruvi Embroidery'
  });
};

exports.postForgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findByEmail(email);
    // Silent success for security
    req.flash('info', 'If an account exists for this email, password reset instructions have been sent.');
    res.redirect('/auth/login');
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
};

/**
 * Google Sign-In backend identity verification (Customer Only)
 * Verifies ID token with Google tokeninfo API, finds/creates customer account, and establishes customer session.
 */
exports.postGoogleVerify = async (req, res) => {
  try {
    const { credential, id_token } = req.body || {};
    const token = credential || id_token;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Google authentication credential missing.' });
    }

    // 1. Verify token server-side with Google tokeninfo API
    const https = require('https');
    const tokenInfo = await new Promise((resolve, reject) => {
      https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, (gRes) => {
        let raw = '';
        gRes.on('data', chunk => raw += chunk);
        gRes.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    if (!tokenInfo || tokenInfo.error || !tokenInfo.email || (tokenInfo.email_verified !== 'true' && tokenInfo.email_verified !== true)) {
      return res.status(400).json({ success: false, message: 'Google authentication failed. Unverified or invalid Google account.' });
    }

    // Validate expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (tokenInfo.exp && Number(tokenInfo.exp) < nowSec) {
      return res.status(400).json({ success: false, message: 'Google authentication token has expired. Please try signing in again.' });
    }

    // Validate Audience if GOOGLE_CLIENT_ID is configured
    const configuredClientId = process.env.GOOGLE_CLIENT_ID;
    if (configuredClientId && configuredClientId !== 'sample-google-client-id') {
      if (tokenInfo.aud !== configuredClientId && tokenInfo.azp !== configuredClientId) {
        return res.status(400).json({ success: false, message: 'Google authentication client ID mismatch.' });
      }
    }

    const email = tokenInfo.email.toLowerCase().trim();
    const fullName = tokenInfo.name || tokenInfo.given_name || 'Valued Customer';

    if (tokenInfo.picture) {
      req.session.googlePicture = tokenInfo.picture;
    }

    // 2. Find or Create Customer Account
    let user = await User.findByEmail(email);

    if (user) {
      if (!user.is_active) {
        return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
      }

      // Establish customer session (Never grant admin privileges via Google Sign-In)
      req.session.userId = user.id;

      if (tokenInfo.picture) {
        await User.updateProfile(user.id, { profile_picture: tokenInfo.picture });
      }

      // Merge guest cart into user account
      if (req.session && req.session.cartSessionId) {
        await Cart.mergeCart(user.id, req.session.cartSessionId);
      }
      if (req.session && req.session.pendingBuyNow) {
        await Cart.addItem(user.id, null, req.session.pendingBuyNow);
        delete req.session.pendingBuyNow;
      }

      const returnTo = getSafeReturnUrl(req.body.returnTo || (req.session ? req.session.returnTo : null));
      if (req.session) delete req.session.returnTo;

      return res.json({
        success: true,
        message: `Welcome back, ${user.full_name}!`,
        redirect: returnTo || '/user/dashboard'
      });
    }

    // 3. Register New Customer linked to Google Email
    const randomPassword = 'GAuth_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
    const newUserId = await User.create({
      full_name: fullName,
      email: email,
      password: randomPassword,
      phone: null,
      address: null,
      profile_picture: tokenInfo.picture || null,
      role: 'customer'
    });

    req.session.userId = newUserId;

    // Merge guest cart into newly created user account
    if (req.session && req.session.cartSessionId) {
      await Cart.mergeCart(newUserId, req.session.cartSessionId);
    }
    if (req.session && req.session.pendingBuyNow) {
      await Cart.addItem(newUserId, null, req.session.pendingBuyNow);
      delete req.session.pendingBuyNow;
    }

    const returnTo = getSafeReturnUrl(req.body.returnTo || (req.session ? req.session.returnTo : null));
    if (req.session) delete req.session.returnTo;

    return res.json({
      success: true,
      message: 'Welcome to Aruvi Embroidery! Account created successfully via Google.',
      redirect: returnTo || '/user/complete-profile'
    });

  } catch (err) {
    console.error('[Google Verify Error]:', err.message);
    return res.status(500).json({ success: false, message: 'Google Sign-In Error: ' + err.message });
  }
};

function getCanonicalRedirectUri(req) {
  const host = (req && req.get ? (req.get('host') || '') : '').toLowerCase();
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return 'http://localhost:3000/auth/google/callback';
  }
  return 'https://aruviembroidery.com/auth/google/callback';
}

/**
 * OAuth Redirect Handler
 */
exports.getGoogleAuth = (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = getCanonicalRedirectUri(req);
  console.log('[Google Auth] Initiating OAuth request with Redirect URI:', redirectUri);

  if (!clientId || clientId === 'sample-google-client-id') {
    req.flash('error', 'Google Sign-In is not currently configured with a valid Google Client ID. Please sign in with your email address.');
    return res.redirect('/auth/login');
  }

  // Preserve returnTo if provided in query
  const returnTarget = getSafeReturnUrl(req.query.returnTo || (req.session ? req.session.returnTo : null));
  if (returnTarget && req.session) {
    req.session.returnTo = returnTarget;
  }

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20profile%20email&access_type=online&prompt=select_account`;
  
  if (req.session) {
    req.session.save(() => res.redirect(googleAuthUrl));
  } else {
    res.redirect(googleAuthUrl);
  }
};

exports.getGoogleCallback = async (req, res, next) => {
  try {
    const { code, error } = req.query;

    if (error || !code) {
      req.flash('error', 'Google Sign-In was cancelled or failed.');
      return res.redirect('/auth/login');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = getCanonicalRedirectUri(req);

    if (!clientId || !clientSecret) {
      req.flash('error', 'Google OAuth credentials missing on server.');
      return res.redirect('/auth/login');
    }

    // Exchange authorization code for tokens
    const querystring = require('querystring');
    const https = require('https');
    const postData = querystring.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const tokenRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const reqObj = https.request(options, (gRes) => {
        let raw = '';
        gRes.on('data', chunk => raw += chunk);
        gRes.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      });

      reqObj.on('error', reject);
      reqObj.write(postData);
      reqObj.end();
    });

    if (!tokenRes || !tokenRes.id_token) {
      console.error('[Google Callback Token Error]:', tokenRes);
      req.flash('error', 'Failed to retrieve Google authentication token.');
      return res.redirect('/auth/login');
    }

    // Process ID Token verification & user login
    const tokenInfo = await new Promise((resolve, reject) => {
      https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenRes.id_token)}`, (gRes) => {
        let raw = '';
        gRes.on('data', chunk => raw += chunk);
        gRes.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    if (!tokenInfo || tokenInfo.error || !tokenInfo.email || (tokenInfo.email_verified !== 'true' && tokenInfo.email_verified !== true)) {
      req.flash('error', 'Google authentication failed. Unverified or invalid Google account.');
      return res.redirect('/auth/login');
    }

    const email = tokenInfo.email.toLowerCase().trim();
    const fullName = tokenInfo.name || tokenInfo.given_name || 'Valued Customer';

    if (tokenInfo.picture) {
      req.session.googlePicture = tokenInfo.picture;
    }

    let user = await User.findByEmail(email);

    if (user) {
      if (!user.is_active) {
        req.flash('error', 'Your account has been deactivated. Please contact support.');
        return res.redirect('/auth/login');
      }

      req.session.userId = user.id;

      if (tokenInfo.picture) {
        await User.updateProfile(user.id, { profile_picture: tokenInfo.picture });
      }

      // Merge guest cart into user account
      if (req.session && req.session.cartSessionId) {
        await Cart.mergeCart(user.id, req.session.cartSessionId);
      }
      if (req.session && req.session.pendingBuyNow) {
        await Cart.addItem(user.id, null, req.session.pendingBuyNow);
        delete req.session.pendingBuyNow;
      }

      const returnTo = getSafeReturnUrl(req.session ? req.session.returnTo : null);
      if (req.session) delete req.session.returnTo;

      req.flash('success', `Welcome back, ${user.full_name}!`);
      if (returnTo) {
        return res.redirect(returnTo);
      }
      return res.redirect('/user/dashboard');
    }

    // Create New Customer
    const randomPassword = 'GAuth_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
    const newUserId = await User.create({
      full_name: fullName,
      email: email,
      password: randomPassword,
      phone: null,
      address: null,
      profile_picture: tokenInfo.picture || null,
      role: 'customer'
    });

    req.session.userId = newUserId;

    // Merge guest cart into newly created user account
    if (req.session && req.session.cartSessionId) {
      await Cart.mergeCart(newUserId, req.session.cartSessionId);
    }
    if (req.session && req.session.pendingBuyNow) {
      await Cart.addItem(newUserId, null, req.session.pendingBuyNow);
      delete req.session.pendingBuyNow;
    }

    const returnTo = getSafeReturnUrl(req.session ? req.session.returnTo : null);
    if (req.session) delete req.session.returnTo;

    req.flash('success', 'Welcome to Aruvi Embroidery! Account created successfully via Google.');
    if (returnTo) {
      return res.redirect(returnTo);
    }
    res.redirect('/user/complete-profile');

  } catch (err) {
    console.error('[Google Callback Exception]:', err);
    req.flash('error', 'An error occurred during Google Sign-In.');
    res.redirect('/auth/login');
  }
};
