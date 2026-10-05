const User = require('../../models/User');

exports.getCustomers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { users: customers, total } = await User.getAll({ page, limit: 15 });

    res.render('admin/customers/index', {
      title: 'Customer Directory - Admin',
      customers,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / 15)
    });
  } catch (err) {
    next(err);
  }
};
