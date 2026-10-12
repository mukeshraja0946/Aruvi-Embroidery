const db = require('../../config/db');
const ActivityLog = require('../../models/ActivityLog');

// Empty fallback store for offline database mode
const fallbackBanners = [];

exports.getBanners = async (req, res, next) => {
  try {
    const { search, status } = req.query;
    let banners = [];
    if (db.isConnected()) {
      let whereClauses = [];
      let params = [];
      if (status === 'active') {
        whereClauses.push('is_active = 1');
      } else if (status === 'inactive') {
        whereClauses.push('is_active = 0');
      }
      if (search && search.trim()) {
        const q = `%${search.trim()}%`;
        whereClauses.push('(title LIKE ? OR link_url LIKE ?)');
        params.push(q, q);
      }
      const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
      banners = await db.query(`SELECT * FROM banners ${whereSql} ORDER BY display_order ASC, id DESC`, params);
    } else {
      banners = [...fallbackBanners];
      if (status === 'active') banners = banners.filter(b => b.is_active);
      else if (status === 'inactive') banners = banners.filter(b => !b.is_active);
    }

    res.render('admin/banners/index', {
      title: 'Manage Banners - Admin',
      banners: banners || [],
      currentSearch: search || '',
      currentStatus: status || ''
    });
  } catch (err) {
    next(err);
  }
};

exports.postCreate = async (req, res, next) => {
  try {
    const { title, link_url, display_order } = req.body;
    const storage = require('../../config/storage');
    let imageUrl = '/public/assets/brand/hero_embroidery.jpg';
    if (req.file) {
      imageUrl = await storage.savePublicFile(req.file.path, req.file.originalname, req.file.mimetype);
    }

    let newId = null;
    if (db.isConnected()) {
      const result = await db.query(
        'INSERT INTO banners (title, image_url, link_url, display_order, is_active) VALUES (?, ?, ?, ?, 1)',
        [title, imageUrl, link_url || '/designs', parseInt(display_order) || 0]
      );
      newId = result.insertId;
    } else {
      newId = fallbackBanners.length + 1;
      fallbackBanners.push({ id: newId, title, image_url: imageUrl, link_url, display_order: parseInt(display_order) || 0, is_active: 1, created_at: new Date() });
    }

    await ActivityLog.logFromReq(req, 'create', 'banner', newId, `Created banner: "${title}"`);
    req.flash('success', 'Banner created successfully.');
    res.redirect('/admin/banners');
  } catch (err) {
    next(err);
  }
};

exports.toggleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    let newStatus = 1;
    if (db.isConnected()) {
      await db.query('UPDATE banners SET is_active = NOT is_active WHERE id = ?', [id]);
      const [row] = await db.query('SELECT is_active, title FROM banners WHERE id = ?', [id]);
      newStatus = row ? row.is_active : 1;
      await ActivityLog.logFromReq(req, 'update_status', 'banner', id, `Updated banner status to ${newStatus ? 'Active' : 'Inactive'}`);
    } else {
      const b = fallbackBanners.find(item => item.id == id);
      if (b) {
        b.is_active = b.is_active ? 0 : 1;
        newStatus = b.is_active;
      }
    }

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, is_active: newStatus, message: `Banner is now ${newStatus ? 'Active' : 'Inactive'}.` });
    }
    req.flash('success', 'Banner status updated.');
    res.redirect('/admin/banners');
  } catch (err) {
    next(err);
  }
};

exports.deleteBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (db.isConnected()) {
      const [b] = await db.query('SELECT title FROM banners WHERE id = ?', [id]);
      await db.query('DELETE FROM banners WHERE id = ?', [id]);
      await ActivityLog.logFromReq(req, 'delete', 'banner', id, `Deleted banner: "${b ? b.title : id}"`);
    } else {
      const idx = fallbackBanners.findIndex(b => b.id == id);
      if (idx !== -1) fallbackBanners.splice(idx, 1);
    }
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'Banner deleted successfully.' });
    }

    req.flash('success', 'Banner deleted successfully.');
    res.redirect('/admin/banners');
  } catch (err) {
    console.error('Delete banner error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete banner. Please try again.' });
    }
    req.flash('error', `Unable to delete banner: ${err.message}`);
    res.redirect('/admin/banners');
  }
};
