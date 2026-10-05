const Order = require('../../models/Order');

exports.getOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const statusFilter = req.query.status || null;
    const { orders, total } = await Order.getAll({ page, limit: 15, status: statusFilter });

    res.render('admin/orders/index', {
      title: 'Manage Orders - Admin',
      orders,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / 15),
      statusFilter
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
