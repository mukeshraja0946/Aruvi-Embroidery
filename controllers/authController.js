const User = require('../models/User');
const { validationResult } = require('express-validator');

exports.getLogin = (req, res) => {
  if (req.user) return res.redirect('/user/dashboard');
  res.render('auth/login', {
    title: 'Customer Login - Aruvi Embroidery'
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

    const returnTo = user.role === 'admin' ? '/admin' : (req.session.returnTo || '/user/dashboard');
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
  res.render('auth/register', {
    title: 'Create Account - Aruvi Embroidery'
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
    req.flash('success', 'Registration successful! Welcome to Aruvi Embroidery.');
    res.redirect('/user/dashboard');
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

    // 2. Find or Create Customer Account
    let user = await User.findByEmail(email);

    if (user) {
      if (!user.is_active) {
        return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
      }

      // Establish customer session (Never grant admin privileges via Google Sign-In)
      req.session.userId = user.id;

      const needsProfile = !user.phone || String(user.phone).trim() === '' || !user.address || String(user.address).trim() === '';
      const targetRedirect = needsProfile ? '/user/complete-profile' : (req.session.returnTo || '/user/dashboard');
      delete req.session.returnTo;

      return res.json({
        success: true,
        message: `Welcome back, ${user.full_name}!`,
        redirect: targetRedirect
      });
    }

    // 3. Register New Customer linked to Google Email
    const randomPassword = 'GAuth_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
    const newUserId = await User.create({
      full_name: fullName,
      email: email,
      password: randomPassword,
      phone: null,
      role: 'customer'
    });

    req.session.userId = newUserId;

    return res.json({
      success: true,
      message: 'Welcome to Aruvi Embroidery! Account created successfully via Google.',
      redirect: '/user/complete-profile'
    });

  } catch (err) {
    console.error('[Google Verify Error]:', err.message);
    return res.status(500).json({ success: false, message: 'Google Sign-In Error: ' + err.message });
  }
};

/**
 * OAuth Redirect Fallback Handler
 */
exports.getGoogleAuth = (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const siteUrl = process.env.SITE_URL || process.env.APP_URL || 'http://localhost:3000';
  const redirectUri = `${siteUrl}/auth/google/callback`;

  if (!clientId || clientId === 'sample-google-client-id') {
    req.flash('error', 'Google Sign-In is not currently configured with a valid Google Client ID. Please sign in with your email address.');
    return res.redirect('/auth/login');
  }

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20profile%20email&access_type=online`;
  res.redirect(googleAuthUrl);
};

exports.getGoogleCallback = async (req, res, next) => {
  try {
    const { code, error } = req.query;

    if (error || !code) {
      req.flash('error', 'Google Sign-In was cancelled or failed.');
      return res.redirect('/auth/login');
    }

    req.flash('info', 'Google OAuth authorization code received. Completing sign in...');
    res.redirect('/auth/login');
  } catch (err) {
    next(err);
  }
};
