const User = require('../../models/User');

exports.getLogin = (req, res) => {
  if (req.user && req.user.role === 'admin') {
    return res.redirect('/admin');
  }
  res.render('admin/login', {
    title: 'Admin Login - ARUVI EMBROIDERY STUDIO'
  });
};

exports.postLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    let inputEmail = (email || '').trim().toLowerCase();

    // Support short username aliases for admin convenience (e.g. 'admin', 'aruvi', 'administrator')
    if (inputEmail === 'admin' || inputEmail === 'aruvi' || inputEmail === 'administrator' || inputEmail === 'admin@aruvi.com') {
      inputEmail = 'admin@aruviembroidery.com';
    }

    let user = await User.findByEmail(inputEmail);
    if (!user && (inputEmail.includes('admin') || inputEmail.includes('aruvi'))) {
      user = await User.findByEmail('admin@aruviembroidery.com');
    }

    if (!user) {
      req.flash('account_not_found', true);
      req.flash('account_email', email);
      return res.redirect('/admin/login');
    }

    if (user.role !== 'admin' || !user.is_active) {
      req.flash('error', 'Unauthorized account or insufficient admin privileges.');
      return res.redirect('/admin/login');
    }

    const isValid = await User.verifyPassword(password, user.password_hash);
    if (!isValid) {
      req.flash('error', 'Incorrect admin password. Please try again.');
      return res.redirect('/admin/login');
    }

    req.session.userId = user.id;
    req.flash('success', 'Logged in to Admin Panel.');
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
};
