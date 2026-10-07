const CustomOrder = require('../../models/CustomOrder');

exports.getCustomOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { requests, total } = await CustomOrder.getAll({ page, limit: 15 });

    res.render('admin/custom-orders/index', {
      title: 'Custom Order Requests - Admin',
      requests,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / 15)
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
