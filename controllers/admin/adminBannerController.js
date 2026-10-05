const db = require('../../config/db');

const fallbackBanners = [
  { id: 1, title: 'Bridal Season Special Sale', image_url: '/public/images/logo.jpg', link_url: '/designs', display_order: 1, is_active: 1 }
];

exports.getBanners = async (req, res, next) => {
  try {
    let banners = [];
    if (db.isConnected()) {
      banners = await db.query('SELECT * FROM banners ORDER BY display_order ASC');
    } else {
      banners = fallbackBanners;
    }

    res.render('admin/banners/index', {
      title: 'Manage Banners - Admin',
      banners
    });
  } catch (err) {
    next(err);
  }
};

exports.postCreate = async (req, res, next) => {
  try {
    const { title, link_url, display_order } = req.body;
    let imageUrl = '/public/images/logo.jpg';
    if (req.file) {
      imageUrl = `/public/uploads/previews/${req.file.filename}`;
    }

    if (db.isConnected()) {
      await db.query(
        'INSERT INTO banners (title, image_url, link_url, display_order, is_active) VALUES (?, ?, ?, ?, 1)',
        [title, imageUrl, link_url || '/designs', display_order || 0]
      );
    } else {
      fallbackBanners.push({ id: fallbackBanners.length + 1, title, image_url: imageUrl, link_url, display_order, is_active: 1 });
    }

    req.flash('success', 'Banner created successfully.');
    res.redirect('/admin/banners');
  } catch (err) {
    next(err);
  }
};

exports.deleteBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (db.isConnected()) {
      await db.query('DELETE FROM banners WHERE id = ?', [id]);
    } else {
      const idx = fallbackBanners.findIndex(b => b.id == id);
      if (idx !== -1) fallbackBanners.splice(idx, 1);
    }
    req.flash('info', 'Banner removed.');
    res.redirect('/admin/banners');
  } catch (err) {
    next(err);
  }
};
