const ContactMessage = require('../../models/ContactMessage');
const AdminStatsService = require('../../services/adminStatsService');

exports.getMessages = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { messages, total } = await ContactMessage.getAll({ page, limit: 15 });
    const stats = await AdminStatsService.getMessageStats();

    res.render('admin/messages/index', {
      title: 'Contact Messages - Admin',
      messages,
      total,
      stats,
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
    const { status } = req.body;
    await ContactMessage.updateStatus(id, status);
    req.flash('success', 'Message status updated.');
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
};

exports.deleteMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    await ContactMessage.delete(id);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';

    if (isAjax) {
      return res.json({ success: true, message: 'Enquiry deleted successfully.' });
    }

    req.flash('success', 'Enquiry deleted successfully.');
    res.redirect('/admin/messages');
  } catch (err) {
    console.error('Delete enquiry error:', err);
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.format === 'json';
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message || 'Unable to delete enquiry. Please try again.' });
    }
    req.flash('error', `Unable to delete enquiry: ${err.message}`);
    res.redirect('/admin/messages');
  }
};
