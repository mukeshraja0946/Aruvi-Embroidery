const CustomOrder = require('../../models/CustomOrder');
const ActivityLog = require('../../models/ActivityLog');

exports.getCustomOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const sort = req.query.sort || 'newest';
    const search = req.query.search || null;
    const status = req.query.status || null;

    const { requests, total } = await CustomOrder.getAll({ page, limit: 15, sort, search, status });
    const stats = await CustomOrder.getStats();

    res.render('admin/custom-orders/index', {
      title: 'Custom Order Requests - Admin',
      requests: requests || [],
      total: total || 0,
      stats,
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

exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;

    await CustomOrder.updateStatus(id, status, admin_notes);
    await ActivityLog.logFromReq(req, 'update_status', 'custom_order', id, `Updated custom request #${id} status to "${status}"`);
    req.flash('success', `Custom request #${id} status updated to "${status}".`);
    res.redirect('/admin/custom-orders');
  } catch (err) {
    next(err);
  }
};

exports.deleteCustomOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    await CustomOrder.delete(id);
    await ActivityLog.logFromReq(req, 'delete', 'custom_order', id, `Deleted custom request #${id}`);

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'Custom order deleted successfully.' });
    }

    req.flash('success', 'Custom order deleted successfully.');
    res.redirect('/admin/custom-orders');
  } catch (err) {
    console.error('Delete custom order error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete custom order. Please try again.' });
    }
    req.flash('error', `Unable to delete custom order: ${err.message}`);
    res.redirect('/admin/custom-orders');
  }
};
