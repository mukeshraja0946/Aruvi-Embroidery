const Review = require('../../models/Review');
const ActivityLog = require('../../models/ActivityLog');

exports.getReviews = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || null;
    const search = req.query.search || null;
    const sort = req.query.sort || 'newest';

    const { reviews, total } = await Review.getAll({ page, limit: 15, status, search, sort });

    res.render('admin/reviews/index', {
      title: 'Customer Reviews - Admin',
      reviews: reviews || [],
      total: total || 0,
      currentPage: page,
      totalPages: Math.ceil((total || 0) / 15) || 1,
      currentSort: sort,
      currentSearch: search || '',
      currentStatus: status || ''
    });
  } catch (err) {
    next(err);
  }
};

exports.toggleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const newStatus = await Review.toggleStatus(id);
    await ActivityLog.logFromReq(req, 'update_status', 'review', id, `Updated review #${id} approval to ${newStatus ? 'Approved' : 'Pending'}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, is_approved: newStatus, message: `Review #${id} is now ${newStatus ? 'Approved' : 'Pending'}.` });
    }
    req.flash('success', `Review #${id} status updated.`);
    res.redirect('/admin/reviews');
  } catch (err) {
    next(err);
  }
};

exports.deleteReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Review.delete(id);
    await ActivityLog.logFromReq(req, 'delete', 'review', id, `Deleted customer review #${id}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.json({ success: true, message: 'Review deleted successfully.' });
    }

    req.flash('success', 'Review deleted successfully.');
    res.redirect('/admin/reviews');
  } catch (err) {
    console.error('Delete review error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete review.' });
    }
    req.flash('error', `Unable to delete review: ${err.message}`);
    res.redirect('/admin/reviews');
  }
};
