const User = require('../../models/User');
const AdminStatsService = require('../../services/adminStatsService');

exports.getCustomers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const sort = req.query.sort || 'newest';
    const search = req.query.search || null;
    const status = req.query.status || null;

    const { users: customers, total } = await User.getAll({ page, limit: 15, sort, search, status });
    const stats = await AdminStatsService.getCustomerStats();

    res.render('admin/customers/index', {
      title: 'Customer Directory - Admin',
      customers,
      total,
      stats,
      currentPage: page,
      totalPages: Math.ceil(total / 15),
      currentSort: sort,
      currentSearch: search || '',
      currentStatus: status || ''
    });
  } catch (err) {
    next(err);
  }
};

exports.deleteCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    await User.delete(id);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'Customer deleted successfully.' });
    }

    req.flash('success', 'Customer deleted successfully.');
    res.redirect('/admin/customers');
  } catch (err) {
    console.error('Delete customer error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete customer. Please try again.' });
    }
    req.flash('error', `Unable to delete customer: ${err.message}`);
    res.redirect('/admin/customers');
  }
};
