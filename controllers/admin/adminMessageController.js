const ContactMessage = require('../../models/ContactMessage');
const AdminStatsService = require('../../services/adminStatsService');

exports.getMessages = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || null;
    const search = req.query.search || null;

    const { messages, total } = await ContactMessage.getAll({ page, limit: 15, status, search });
    const stats = await AdminStatsService.getMessageStats();

    res.render('admin/messages/index', {
      title: 'Contact Messages - Admin',
      messages,
      total,
      stats,
      currentPage: page,
      totalPages: Math.ceil(total / 15),
      query: req.query
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Manually Create Enquiry by Admin
 */
exports.createEnquiry = async (req, res, next) => {
  try {
    const { name, email, subject, message, status } = req.body;

    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanSubject = (subject || 'Admin Inquiry Record').trim();
    const cleanMessage = (message || '').trim();

    if (!cleanName || !cleanEmail || !cleanMessage) {
      return res.status(400).json({ success: false, message: 'Customer Name, Email, and Message are required.' });
    }

    if (!cleanEmail.includes('@')) {
      return res.status(400).json({ success: false, message: 'Please enter a valid customer email address.' });
    }

    const enquiryId = await ContactMessage.create({
      name: cleanName,
      email: cleanEmail,
      subject: cleanSubject,
      message: cleanMessage,
      status: status || 'new',
      source: 'admin_created'
    });

    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.json({
        success: true,
        message: 'Manual Enquiry record created successfully.',
        enquiryId
      });
    }

    req.flash('success', 'Manual Enquiry created successfully.');
    res.redirect('/admin/messages');
  } catch (err) {
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
    if (isAjax) {
      return res.status(500).json({ success: false, message: err.message });
    }
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
