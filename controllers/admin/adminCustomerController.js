const User = require('../../models/User');
const AdminStatsService = require('../../services/adminStatsService');
const ActivityLog = require('../../models/ActivityLog');

exports.getCustomers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const sort = req.query.sort || 'newest';
    const search = req.query.search || null;
    const status = req.query.status || null;

    const { users: customers, total } = await User.getAll({ page, limit: 15, sort, search, status, role: 'customer' });
    const stats = await AdminStatsService.getCustomerStats();

    res.render('admin/customers/index', {
      title: 'Customer Directory - Admin',
      customers: customers || [],
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

exports.deleteCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    await User.delete(id);
    await ActivityLog.logFromReq(req, 'delete', 'customer', id, `Deleted customer account #${id} (${user ? user.email : id})`);

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
