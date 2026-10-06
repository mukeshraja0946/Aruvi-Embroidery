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
