const ContactMessage = require('../../models/ContactMessage');

exports.getMessages = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { messages, total } = await ContactMessage.getAll({ page, limit: 15 });

    res.render('admin/messages/index', {
      title: 'Contact Messages - Admin',
      messages,
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
    const { status } = req.body;
    await ContactMessage.updateStatus(id, status);
    req.flash('success', 'Message status updated.');
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
};
