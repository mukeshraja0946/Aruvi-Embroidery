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
