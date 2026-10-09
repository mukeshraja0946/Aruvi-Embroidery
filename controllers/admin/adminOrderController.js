const Order = require('../../models/Order');
const AdminStatsService = require('../../services/adminStatsService');

exports.getOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const statusFilter = req.query.status || null;
    const { orders, total } = await Order.getAll({ page, limit: 15, status: statusFilter });
    const stats = await AdminStatsService.getOrderStats();

    res.render('admin/orders/index', {
      title: 'Manage Orders - Admin',
      orders,
      total,
      stats,
      currentPage: page,
      totalPages: Math.ceil(total / 15),
      currentStatus: statusFilter
    });
  } catch (err) {
    next(err);
  }
};

exports.getOrderDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.getById(id);

    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/admin/orders');
    }

    res.render('admin/orders/detail', {
      title: `Order #${order.order_number} Details - Admin`,
      order
    });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await Order.updateStatus(id, status);
    req.flash('success', `Order #${id} status updated to ${status}.`);
    res.redirect('/admin/orders');
  } catch (err) {
    next(err);
  }
};

exports.deleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Order.delete(id);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'Order deleted successfully.' });
    }

    req.flash('success', 'Order deleted successfully.');
    res.redirect('/admin/orders');
  } catch (err) {
    console.error('Delete order error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete order. Please try again.' });
    }
    req.flash('error', `Unable to delete order: ${err.message}`);
    res.redirect('/admin/orders');
  }
};
