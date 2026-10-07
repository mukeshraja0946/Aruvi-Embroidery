const Setting = require('../../models/Setting');
const emailService = require('../../services/emailService');

exports.testSmtp = async (req, res, next) => {
  try {
    const result = await emailService.testSmtpConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: `SMTP test error: ${err.message}` });
  }
};

exports.getSettings = async (req, res, next) => {
  try {
    const settings = await Setting.getAll();
    res.render('admin/settings/index', {
      title: 'Store Settings - Admin',
      settings
    });
  } catch (err) {
    next(err);
  }
};

exports.postSettings = async (req, res, next) => {
  try {
    const b = req.body || {};

    const shop_name = b.shop_name;
    const tagline = b.tagline;
    const contact_email = b.contact_email;
    const contact_phone = b.contact_phone;
    const address = b.address;
    const currency_symbol = b.currency_symbol;
    const facebook_url = b.facebook_url;
    const instagram_url = b.instagram_url;
    const linkedin_url = b.linkedin_url;
    const youtube_url = b.youtube_url;

    // All 6 UPI & Bank fields with fallback alias mapping
    const upi_id = (b.upi_id !== undefined ? b.upi_id : (b.upiId !== undefined ? b.upiId : b.upi_vpa)) || '';
    const upi_name = (b.upi_name !== undefined ? b.upi_name : (b.upiName !== undefined ? b.upiName : (b.upiMerchantName !== undefined ? b.upiMerchantName : b.merchant_name))) || '';
    const bank_name = (b.bank_name !== undefined ? b.bank_name : b.bankName) || '';
    const account_number = (b.account_number !== undefined ? b.account_number : (b.accountNumber !== undefined ? b.accountNumber : b.bank_account_no)) || '';
    const ifsc_code = (b.ifsc_code !== undefined ? b.ifsc_code : (b.ifscCode !== undefined ? b.ifscCode : b.ifsc)) || '';
    const account_holder = (b.account_holder !== undefined ? b.account_holder : (b.accountHolder !== undefined ? b.accountHolder : (b.accountHolderName !== undefined ? b.accountHolderName : b.account_holder_name))) || '';

    const remove_logo = b.remove_logo;
    const remove_mobile_logo = b.remove_mobile_logo;
    const remove_favicon = b.remove_favicon;
    const logo_url = b.logo_url;
    const mobile_logo_url = b.mobile_logo_url;
    const favicon_url = b.favicon_url;

    // Validation
    const cleanUpiId = upi_id.trim();
    if (cleanUpiId && !cleanUpiId.includes('@')) {
      const errMessage = 'Invalid UPI ID format. UPI ID must be a valid VPA (e.g. username@upi or number@paytm).';
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ success: false, message: errMessage });
      }
      req.flash('error', errMessage);
      return res.redirect('/admin/settings');
    }

    const cleanIfsc = ifsc_code.trim();
    if (cleanIfsc && cleanIfsc.length !== 11) {
      const errMessage = 'Invalid IFSC Code format. IFSC code must be 11 characters (e.g. SBIN0001234).';
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ success: false, message: errMessage });
      }
      req.flash('error', errMessage);
      return res.redirect('/admin/settings');
    }

    const updates = {
      shop_name,
      tagline,
      contact_email,
      contact_phone,
      address,
      currency_symbol,
      facebook_url,
      instagram_url,
      linkedin_url,
      youtube_url,
      upi_id: cleanUpiId,
      upi_name: upi_name.trim(),
      bank_name: bank_name.trim(),
      account_number: account_number.trim(),
      ifsc_code: cleanIfsc.toUpperCase(),
      account_holder: account_holder.trim()
    };

    if (logo_url) updates.logo_url = logo_url;
    if (mobile_logo_url) updates.mobile_logo_url = mobile_logo_url;
    if (favicon_url) updates.favicon_url = favicon_url;

    if (remove_logo === '1') updates.logo_url = '/public/images/logo.jpg';
    if (remove_mobile_logo === '1') updates.mobile_logo_url = '/public/images/logo.jpg';
    if (remove_favicon === '1') updates.favicon_url = '/public/images/logo.jpg';

    if (req.files) {
      if (req.files.logo_image && req.files.logo_image[0]) {
        updates.logo_url = `/public/uploads/previews/${req.files.logo_image[0].filename}`;
      }
      if (req.files.mobile_logo_image && req.files.mobile_logo_image[0]) {
        updates.mobile_logo_url = `/public/uploads/previews/${req.files.mobile_logo_image[0].filename}`;
      }
      if (req.files.favicon_image && req.files.favicon_image[0]) {
        updates.favicon_url = `/public/uploads/previews/${req.files.favicon_image[0].filename}`;
      }
    }

    // Secure logging of masked values (Section 22 requirement)
    const maskedAcct = updates.account_number ? ('*'.repeat(Math.max(0, updates.account_number.length - 4)) + updates.account_number.slice(-4)) : 'N/A';
    console.log(`[Admin Settings Update] UPI ID: ${updates.upi_id}, Merchant: ${updates.upi_name}, Bank: ${updates.bank_name}, Acct: ${maskedAcct}`);

    await Setting.updateAll(updates);
    const refreshedSettings = await Setting.getAll();
    if (req.app) {
      req.app.locals.siteSettings = {
        ...(req.app.locals.siteSettings || {}),
        ...refreshedSettings
      };
    }

    const successMessage = 'Payment settings and store branding updated successfully! All changes are synchronized across database and checkout.';

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.json({
        success: true,
        message: successMessage,
        settings: refreshedSettings
      });
    }

    req.flash('success', successMessage);
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
};

exports.getHomepageEditor = async (req, res, next) => {
  try {
    const settings = await Setting.getAll();
    res.render('admin/homepage/index', {
      title: 'Homepage Content Management - Admin',
      settings
    });
  } catch (err) {
    next(err);
  }
};

exports.postHomepageEditor = async (req, res, next) => {
  try {
    const {
      announcement_bar,
      hero_eyebrow,
      hero_title,
      hero_subtitle,
      stat_designs_count,
      stat_customers_count,
      stat_rating
    } = req.body;

    const updates = {
      announcement_bar,
      hero_eyebrow,
      hero_title,
      hero_subtitle,
      stat_designs_count,
      stat_customers_count,
      stat_rating
    };

    if (req.file) {
      updates.hero_image = `/public/uploads/previews/${req.file.filename}`;
    }

    await Setting.updateAll(updates);

    req.flash('success', 'Homepage content updated successfully! All changes are live on the customer website.');
    res.redirect('/admin/homepage');
  } catch (err) {
    next(err);
  }
};
