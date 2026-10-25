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

exports.testRazorpay = async (req, res, next) => {
  try {
    const Razorpay = require('razorpay');
    let { key_id, key_secret } = req.body || {};

    if (!key_id || !key_secret || key_secret.startsWith('••••')) {
      const config = await Setting.getRazorpayConfig();
      key_id = key_id || config.keyId;
      key_secret = (key_secret && !key_secret.startsWith('••••')) ? key_secret : config.keySecret;
    }

    key_id = (key_id || '').trim();
    key_secret = (key_secret || '').trim();

    if (!key_id || !key_secret) {
      return res.status(400).json({
        success: false,
        message: 'Razorpay Key ID and Key Secret are required to test connection.'
      });
    }

    const testClient = new Razorpay({
      key_id,
      key_secret
    });

    const testOrder = await testClient.orders.create({
      amount: 100,
      currency: 'INR',
      receipt: 'test_' + Date.now().toString().slice(-10),
      payment_capture: 1
    });

    const mode = key_id.startsWith('rzp_live') ? 'LIVE' : 'TEST';
    return res.json({
      success: true,
      mode,
      orderId: testOrder.id,
      message: `Connected successfully to Razorpay API in ${mode} mode!`
    });
  } catch (err) {
    const statusCode = err.statusCode || (err.error && err.error.code) || 500;
    const description = (err.error && err.error.description) || err.message || 'Razorpay authentication failed.';
    return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      success: false,
      message: `Razorpay connection failed: ${description}`,
      statusCode
    });
  }
};

exports.getSettings = async (req, res, next) => {
  try {
    const settings = await Setting.getAll();
    const rzpConfig = await Setting.getRazorpayConfig();
    res.render('admin/settings/index', {
      title: 'Store Settings - Admin',
      settings,
      rzpConfig
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
      upi_name: upi_name.trim(),
      max_upload_zip_size_mb: b.max_upload_zip_size_mb ? String(Math.max(1, parseInt(b.max_upload_zip_size_mb, 10))) : '100',
      auto_detect_formats_policy: b.auto_detect_formats_policy === 'overwrite' ? 'overwrite' : 'fill_if_empty',
      razorpay_key_id: b.razorpay_key_id !== undefined ? b.razorpay_key_id.trim() : undefined,
      razorpay_key_secret: b.razorpay_key_secret !== undefined ? b.razorpay_key_secret.trim() : undefined,
      razorpay_mode: b.razorpay_mode !== undefined ? b.razorpay_mode.trim() : undefined,
      razorpay_webhook_secret: b.razorpay_webhook_secret !== undefined ? b.razorpay_webhook_secret.trim() : undefined,
      hide_empty_categories_in_pills: b.hide_empty_categories_in_pills === 'true' || b.hide_empty_categories_in_pills === '1' ? 'true' : (b.hide_empty_categories_in_pills === 'false' || b.hide_empty_categories_in_pills === '0' ? 'false' : undefined),
      show_category_banner_mobile: b.show_category_banner_mobile === '1' ? '1' : '0',
      show_sku_on_cards: b.show_sku_on_cards === '1' ? '1' : '0',
      show_design_reviews: b.show_design_reviews === '1' ? '1' : '0',
      show_design_related: b.show_design_related === '1' ? '1' : '0',
      stitch_number_format: b.stitch_number_format === 'international' ? 'international' : 'indian',
      show_stitch_front: b.show_stitch_front === '1' ? '1' : '0',
      label_stitch_front: (b.label_stitch_front !== undefined && b.label_stitch_front.trim()) ? b.label_stitch_front.trim() : 'Stitch Count (Front)',
      show_stitch_back: b.show_stitch_back === '1' ? '1' : '0',
      label_stitch_back: (b.label_stitch_back !== undefined && b.label_stitch_back.trim()) ? b.label_stitch_back.trim() : 'Stitch Count (Back)',
      show_stitch_sleeve: b.show_stitch_sleeve === '1' ? '1' : '0',
      label_stitch_sleeve: (b.label_stitch_sleeve !== undefined && b.label_stitch_sleeve.trim()) ? b.label_stitch_sleeve.trim() : 'Stitch Count (Sleeve)',
      show_stitch_total: b.show_stitch_total === '1' ? '1' : '0',
      label_stitch_total: (b.label_stitch_total !== undefined && b.label_stitch_total.trim()) ? b.label_stitch_total.trim() : 'Total Stitch Count',
      show_stitch_on_cards: b.show_stitch_on_cards === '1' ? '1' : '0',
      about_hero_title: b.about_hero_title !== undefined ? b.about_hero_title.trim() : undefined,
      about_hero_subtitle: b.about_hero_subtitle !== undefined ? b.about_hero_subtitle.trim() : undefined,
      about_hero_description: b.about_hero_description !== undefined ? b.about_hero_description.trim() : undefined,
      about_story_title: b.about_story_title !== undefined ? b.about_story_title.trim() : undefined,
      about_story_p1: b.about_story_p1 !== undefined ? b.about_story_p1.trim() : undefined,
      about_story_p2: b.about_story_p2 !== undefined ? b.about_story_p2.trim() : undefined,
      about_stats_mode: b.about_stats_mode !== undefined ? b.about_stats_mode : undefined,
      about_stat1_num: b.about_stat1_num !== undefined ? b.about_stat1_num.trim() : undefined,
      about_stat1_label: b.about_stat1_label !== undefined ? b.about_stat1_label.trim() : undefined,
      about_stat2_num: b.about_stat2_num !== undefined ? b.about_stat2_num.trim() : undefined,
      about_stat2_label: b.about_stat2_label !== undefined ? b.about_stat2_label.trim() : undefined,
      about_stat3_num: b.about_stat3_num !== undefined ? b.about_stat3_num.trim() : undefined,
      about_stat3_label: b.about_stat3_label !== undefined ? b.about_stat3_label.trim() : undefined,
      about_stat4_num: b.about_stat4_num !== undefined ? b.about_stat4_num.trim() : undefined,
      about_stat4_label: b.about_stat4_label !== undefined ? b.about_stat4_label.trim() : undefined,
      about_mission_title: b.about_mission_title !== undefined ? b.about_mission_title.trim() : undefined,
      about_mission_text: b.about_mission_text !== undefined ? b.about_mission_text.trim() : undefined,
      about_vision_title: b.about_vision_title !== undefined ? b.about_vision_title.trim() : undefined,
      about_vision_text: b.about_vision_text !== undefined ? b.about_vision_text.trim() : undefined,
      about_values_title: b.about_values_title !== undefined ? b.about_values_title.trim() : undefined,
      about_values_text: b.about_values_text !== undefined ? b.about_values_text.trim() : undefined,
      show_about_story_image: b.show_about_story_image === '1' ? '1' : '0',
      show_contact_map: b.show_contact_map === '1' ? '1' : '0',
      contact_address_line: b.contact_address_line !== undefined ? b.contact_address_line.trim() : undefined,
      feature_card1_title: b.feature_card1_title !== undefined ? b.feature_card1_title.trim() : undefined,
      feature_card1_subtitle: b.feature_card1_subtitle !== undefined ? b.feature_card1_subtitle.trim() : undefined,
      feature_card1_icon: b.feature_card1_icon !== undefined ? b.feature_card1_icon.trim() : undefined,
      feature_card2_title: b.feature_card2_title !== undefined ? b.feature_card2_title.trim() : undefined,
      feature_card2_subtitle: b.feature_card2_subtitle !== undefined ? b.feature_card2_subtitle.trim() : undefined,
      feature_card2_icon: b.feature_card2_icon !== undefined ? b.feature_card2_icon.trim() : undefined,
      feature_card3_title: b.feature_card3_title !== undefined ? b.feature_card3_title.trim() : undefined,
      feature_card3_subtitle: b.feature_card3_subtitle !== undefined ? b.feature_card3_subtitle.trim() : undefined,
      feature_card3_icon: b.feature_card3_icon !== undefined ? b.feature_card3_icon.trim() : undefined,
      feature_card4_title: b.feature_card4_title !== undefined ? b.feature_card4_title.trim() : undefined,
      feature_card4_subtitle: b.feature_card4_subtitle !== undefined ? b.feature_card4_subtitle.trim() : undefined,
      feature_card4_icon: b.feature_card4_icon !== undefined ? b.feature_card4_icon.trim() : undefined
    };

    if (b.remove_about_story_image === '1') updates.about_story_image = '';
    if (b.remove_contact_map_image === '1') updates.contact_map_image = '';

    if (logo_url) updates.logo_url = logo_url;
    if (mobile_logo_url) updates.mobile_logo_url = mobile_logo_url;
    if (favicon_url) updates.favicon_url = favicon_url;

    const storage = require('../../config/storage');

    if (remove_logo === '1') updates.logo_url = '/public/assets/brand/logo.png';
    if (remove_mobile_logo === '1') updates.mobile_logo_url = '/public/assets/brand/logo.png';
    if (remove_favicon === '1') updates.favicon_url = '/public/assets/brand/favicon.ico';

    if (req.files) {
      if (req.files.logo_image && req.files.logo_image[0]) {
        const file = req.files.logo_image[0];
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
        updates.logo_url = savedUrl;
      }
      if (req.files.mobile_logo_image && req.files.mobile_logo_image[0]) {
        const file = req.files.mobile_logo_image[0];
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
        updates.mobile_logo_url = savedUrl;
      }
      if (req.files.favicon_image && req.files.favicon_image[0]) {
        const file = req.files.favicon_image[0];
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
        updates.favicon_url = savedUrl;
      }
      if (req.files.about_story_image && req.files.about_story_image[0]) {
        const file = req.files.about_story_image[0];
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
        updates.about_story_image = savedUrl;
      }
      if (req.files.contact_map_image && req.files.contact_map_image[0]) {
        const file = req.files.contact_map_image[0];
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);
        updates.contact_map_image = savedUrl;
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
      stat_rating,
      feature_card1_title,
      feature_card1_subtitle,
      feature_card1_icon,
      feature_card2_title,
      feature_card2_subtitle,
      feature_card2_icon,
      feature_card3_title,
      feature_card3_subtitle,
      feature_card3_icon,
      feature_card4_title,
      feature_card4_subtitle,
      feature_card4_icon
    } = req.body;

    const updates = {
      announcement_bar,
      hero_eyebrow,
      hero_title,
      hero_subtitle,
      stat_designs_count,
      stat_customers_count,
      stat_rating,
      feature_card1_title: feature_card1_title !== undefined ? feature_card1_title.trim() : undefined,
      feature_card1_subtitle: feature_card1_subtitle !== undefined ? feature_card1_subtitle.trim() : undefined,
      feature_card1_icon: feature_card1_icon !== undefined ? feature_card1_icon.trim() : undefined,
      feature_card2_title: feature_card2_title !== undefined ? feature_card2_title.trim() : undefined,
      feature_card2_subtitle: feature_card2_subtitle !== undefined ? feature_card2_subtitle.trim() : undefined,
      feature_card2_icon: feature_card2_icon !== undefined ? feature_card2_icon.trim() : undefined,
      feature_card3_title: feature_card3_title !== undefined ? feature_card3_title.trim() : undefined,
      feature_card3_subtitle: feature_card3_subtitle !== undefined ? feature_card3_subtitle.trim() : undefined,
      feature_card3_icon: feature_card3_icon !== undefined ? feature_card3_icon.trim() : undefined,
      feature_card4_title: feature_card4_title !== undefined ? feature_card4_title.trim() : undefined,
      feature_card4_subtitle: feature_card4_subtitle !== undefined ? feature_card4_subtitle.trim() : undefined,
      feature_card4_icon: feature_card4_icon !== undefined ? feature_card4_icon.trim() : undefined
    };

    if (req.file) {
      const storage = require('../../config/storage');
      const savedHeroUrl = await storage.savePublicFile(req.file.path, req.file.originalname, req.file.mimetype);
      updates.hero_image = savedHeroUrl;
    }

    await Setting.updateAll(updates);

    req.flash('success', 'Homepage content updated successfully! All changes are live on the customer website.');
    res.redirect('/admin/homepage');
  } catch (err) {
    next(err);
  }
};
