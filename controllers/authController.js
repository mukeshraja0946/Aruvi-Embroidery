const User = require('../models/User');
const { validationResult } = require('express-validator');

exports.getLogin = (req, res) => {
  if (req.user) return res.redirect('/user/dashboard');
  res.render('auth/login', {
    title: 'Customer Login - Aruvi Embroidery'
  });
};

exports.postLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findByEmail(email);

    if (!user) {
      req.flash('account_not_found', true);
      req.flash('account_email', email);
      return res.redirect('/auth/login');
    }

    if (!user.is_active) {
      req.flash('error', 'Your account has been deactivated. Please contact support.');
      return res.redirect('/auth/login');
    }

    const isValid = await User.verifyPassword(password, user.password_hash);
    if (!isValid) {
      req.flash('error', 'Incorrect password. Please try again.');
      return res.redirect('/auth/login');
    }

    req.session.userId = user.id;

    if (user.role === 'admin') {
      req.flash('success', 'Logged in to Admin Panel.');
      return res.redirect('/admin');
    }

    req.flash('success', `Welcome back, ${user.full_name}!`);
    const returnTo = req.session.returnTo || '/user/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
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
