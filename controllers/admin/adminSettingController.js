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

function validateSocialMediaUrl(rawUrl, platformName, allowedDomains) {
  if (rawUrl === undefined || rawUrl === null) {
    return { valid: true, cleanUrl: '' };
  }
  let trimmed = String(rawUrl).trim();
  if (trimmed === '') {
    return { valid: true, cleanUrl: '' };
  }

  // Prepend https:// if protocol was omitted
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: `${platformName} URL must use HTTP or HTTPS protocol.` };
    }

    if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
      const host = parsed.hostname.toLowerCase();
      const isDomainMatch = allowedDomains.some(d => host === d || host.endsWith('.' + d));
      if (!isDomainMatch) {
        return {
          valid: false,
          error: `${platformName} URL must point to a valid ${platformName} address (e.g. https://${allowedDomains[0]}/yourprofile), not another platform.`
        };
      }
    }

    return { valid: true, cleanUrl: parsed.toString() };
  } catch (e) {
    return { valid: false, error: `Invalid ${platformName} URL format. Please enter a valid web address.` };
  }
}

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
    const pinterest_url = b.pinterest_url;
    const youtube_url = b.youtube_url;

    // All UPI fields with fallback alias mapping
    const upi_id = (b.upi_id !== undefined ? b.upi_id : (b.upiId !== undefined ? b.upiId : b.upi_vpa)) || '';
    const upi_name = (b.upi_name !== undefined ? b.upi_name : (b.upiName !== undefined ? b.upiName : (b.upiMerchantName !== undefined ? b.upiMerchantName : b.merchant_name))) || '';

    const remove_logo = b.remove_logo;
    const remove_mobile_logo = b.remove_mobile_logo;
    const remove_favicon = b.remove_favicon;
    const logo_url = b.logo_url;
    const mobile_logo_url = b.mobile_logo_url;
    const favicon_url = b.favicon_url;

    // Validation for Social Media URLs
    const fbCheck = validateSocialMediaUrl(facebook_url, 'Facebook', ['facebook.com', 'fb.com', 'fb.me', 'fb.watch']);
    if (!fbCheck.valid) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ success: false, message: fbCheck.error });
      }
      req.flash('error', fbCheck.error);
      return res.redirect('/admin/settings');
    }

    const instaCheck = validateSocialMediaUrl(instagram_url, 'Instagram', ['instagram.com', 'instagr.am']);
    if (!instaCheck.valid) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ success: false, message: instaCheck.error });
      }
      req.flash('error', instaCheck.error);
      return res.redirect('/admin/settings');
    }

    const pinCheck = validateSocialMediaUrl(pinterest_url, 'Pinterest', ['pinterest.com', 'pin.it', 'pinterest.co.uk', 'pinterest.ca']);
    if (!pinCheck.valid) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ success: false, message: pinCheck.error });
      }
      req.flash('error', pinCheck.error);
      return res.redirect('/admin/settings');
    }

    const ytCheck = validateSocialMediaUrl(youtube_url, 'YouTube', ['youtube.com', 'youtu.be']);
    if (!ytCheck.valid) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(400).json({ success: false, message: ytCheck.error });
      }
      req.flash('error', ytCheck.error);
      return res.redirect('/admin/settings');
    }

    // Validation for UPI ID
    const cleanUpiId = upi_id.trim();
    if (cleanUpiId && !cleanUpiId.includes('@')) {
      const errMessage = 'Invalid UPI ID format. UPI ID must be a valid VPA (e.g. username@upi or number@paytm).';
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
      facebook_url: fbCheck.cleanUrl,
      instagram_url: instaCheck.cleanUrl,
      pinterest_url: pinCheck.cleanUrl,
      youtube_url: ytCheck.cleanUrl,
      upi_id: cleanUpiId,
      upi_name: upi_name.trim()
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

    console.log(`[Admin Settings Update] UPI ID: ${updates.upi_id}, Merchant: ${updates.upi_name}, Pinterest: ${updates.pinterest_url}`);

    await Setting.updateAll(updates);
    const refreshedSettings = await Setting.getAll();
    if (req.app) {
      req.app.locals.siteSettings = {
        ...(req.app.locals.siteSettings || {}),
        ...refreshedSettings
      };
    }

    const successMessage = 'Store settings and social media links updated successfully! All changes are synchronized with the website footer.';

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
