const ContactMessage = require('../models/ContactMessage');
const CustomOrder = require('../models/CustomOrder');
const CustomRequest = require('../models/CustomRequest');
const Design = require('../models/Design');
const Category = require('../models/Category');
const Setting = require('../models/Setting');
const storage = require('../config/storage');
const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { sendCustomerConfirmation, sendAdminNotification } = require('../services/customRequestEmailService');

function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
  // WEBP: RIFF .... WEBP
  if (buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP') return true;
  return false;
}


exports.getAbout = async (req, res, next) => {
  try {
    const settings = await Setting.getAll();
    const statsMode = settings.about_stats_mode || 'auto';

    let stats = {
      stat1: { num: settings.about_stat1_num || '10,000+', label: settings.about_stat1_label || 'Happy Customers' },
      stat2: { num: settings.about_stat2_num || '5,000+', label: settings.about_stat2_label || 'Unique Designs' },
      stat3: { num: settings.about_stat3_num || '50+', label: settings.about_stat3_label || 'Countries Worldwide' },
      stat4: { num: settings.about_stat4_num || '4.9/5', label: settings.about_stat4_label || 'Customer Rating' }
    };

    if (statsMode === 'auto' && db.isConnected()) {
      try {
        // 1. Real Happy Customers
        let realCustomers = 0;
        const custRes = await db.query("SELECT COUNT(DISTINCT user_id) as cnt FROM orders WHERE status IN ('completed', 'paid')");
        realCustomers = parseInt(custRes[0]?.cnt || 0, 10);
        if (realCustomers === 0) {
          const userRes = await db.query("SELECT COUNT(*) as cnt FROM users WHERE role = 'customer'");
          realCustomers = parseInt(userRes[0]?.cnt || 0, 10);
        }
        stats.stat1.num = realCustomers > 0 ? (realCustomers >= 10 ? `${realCustomers}+` : `${realCustomers}`) : '100+';

        // 2. Real Active Designs
        const desRes = await db.query("SELECT COUNT(*) as cnt FROM designs WHERE is_active = 1");
        const realDesigns = parseInt(desRes[0]?.cnt || 0, 10);
        stats.stat2.num = realDesigns > 0 ? (realDesigns >= 10 ? `${realDesigns}+` : `${realDesigns}`) : '100+';

        // 3. Real Countries
        const cRes = await db.query("SELECT COUNT(DISTINCT country) as cnt FROM orders WHERE country IS NOT NULL AND country != ''");
        const realCountries = Math.max(1, parseInt(cRes[0]?.cnt || 1, 10));
        stats.stat3.num = `${realCountries}+`;

        // 4. Real Rating from Approved Reviews
        const revRes = await db.query("SELECT AVG(rating) as avg_r, COUNT(*) as cnt FROM reviews WHERE status = 'approved'");
        if (revRes[0] && revRes[0].cnt > 0 && revRes[0].avg_r !== null) {
          stats.stat4.num = `${parseFloat(revRes[0].avg_r).toFixed(1)}/5`;
        } else {
          stats.stat4.num = '5.0/5';
        }
      } catch (dbErr) {
        console.warn('Error calculating auto stats for about page:', dbErr.message);
      }
    }

    res.render('pages/about', {
      title: 'About Us - ARUVI EMBROIDERY STUDIO',
      settings,
      stats
    });
  } catch (err) {
    next(err);
  }
};

exports.getContact = (req, res) => {
  res.render('pages/contact', {
    title: 'Get in Touch - ARUVI EMBROIDERY STUDIO'
  });
};

exports.postContact = async (req, res, next) => {
  try {
    const { name, email, subject, phone, message, website_url_hp } = req.body;

    // Honeypot bot protection check
    if (website_url_hp && website_url_hp.trim() !== '') {
      console.warn('[Spam Submission Prevented] Honeypot filled on /contact form');
      req.flash('success', 'Thank you! Your message has been sent. We will get back to you within 24 hours.');
      return res.redirect('/contact');
    }

    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanSubject = (subject || 'General Inquiry').trim();
    const cleanMessage = (message || '').trim();

    if (!cleanName || !cleanEmail || !cleanMessage) {
      req.flash('error', 'Please fill in all required fields (Name, Email, and Message).');
      return res.redirect('/contact');
    }

    if (!cleanEmail.includes('@') || cleanEmail.length < 5) {
      req.flash('error', 'Please enter a valid email address.');
      return res.redirect('/contact');
    }

    if (cleanMessage.length < 5) {
      req.flash('error', 'Message must be at least 5 characters long.');
      return res.redirect('/contact');
    }

    // Check for duplicate submission within 30s
    const duplicate = await ContactMessage.findRecentDuplicate(cleanEmail, cleanMessage);
    if (duplicate) {
      req.flash('success', 'Thank you! Your message has already been received.');
      return res.redirect('/contact');
    }

    await ContactMessage.create({
      name: cleanName,
      email: cleanEmail,
      subject: cleanSubject,
      message: cleanMessage,
      source: 'customer_form'
    });

    req.flash('success', 'Thank you! Your message has been sent. We will get back to you within 24 hours.');
    res.redirect('/contact');
  } catch (err) {
    next(err);
  }
};

exports.getCustomOrder = async (req, res) => {
  // Safe load of optional data (categories, settings) wrapped in try/catch with fallback defaults
  let categories = [];
  try {
    categories = await Category.getAll();
  } catch (catErr) {
    console.warn('[CustomOrder Page Warning] Categories optional load failed:', catErr.message);
  }

  // Idempotency token generation for double-submit prevention
  if (!req.session.customOrderIdempotencyToken) {
    req.session.customOrderIdempotencyToken = crypto.randomBytes(16).toString('hex');
  }

  // Retrieve preserved form input and field-level validation errors from flash
  const flashedData = req.flash('form_data');
  const flashedErrors = req.flash('field_errors');
  const formData = (flashedData && flashedData[0]) ? flashedData[0] : {};
  const fieldErrors = (flashedErrors && flashedErrors[0]) ? flashedErrors[0] : {};

  // Safe CSRF token retrieval
  const csrfToken = (typeof req.csrfToken === 'function') 
    ? req.csrfToken() 
    : (res.locals.csrfToken || (req.session && req.session.csrfSecret) || '');

  res.render('pages/custom-order', {
    title: 'Request a Custom Design - ARUVI EMBROIDERY STUDIO',
    categories: categories || [],
    formData,
    fieldErrors,
    idempotencyToken: req.session.customOrderIdempotencyToken,
    csrfToken
  });
};

exports.postCustomOrder = async (req, res, next) => {
  const isAjax = Boolean(req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json')) || (req.body && req.body.is_ajax === '1') || (req.query && (req.query.ajax === '1' || req.query.format === 'json')));

  try {
    const {
      name,
      full_name,
      email,
      phone,
      design_title,
      description,
      design_details,
      category_id,
      design_type,
      purpose,
      preferred_formats,
      formats,
      width_mm,
      height_mm,
      size_hoop,
      budget,
      deadline,
      company_website_hp,
      idempotency_token
    } = req.body;

    // 1. Anti-spam honeypot detection
    if (company_website_hp && String(company_website_hp).trim() !== '') {
      console.warn(`[Anti-Spam Alert] Honeypot triggered on /custom-order by IP ${req.ip || 'unknown'}`);
      if (isAjax) {
        return res.json({ success: true, message: 'Thank you! Your custom embroidery request has been received.', requestNumber: 'CR-SPAM-PREV' });
      }
      req.flash('success', 'Thank you! Your custom embroidery request has been received. Our master digitizers will review it.');
      return res.redirect('/custom-order');
    }

    // 2. Double-submit protection via idempotency token
    const token = idempotency_token || req.body._idempotency;
    if (token && req.session && req.session.processedCustomTokens && req.session.processedCustomTokens[token]) {
      const prev = req.session.processedCustomTokens[token];
      console.log(`[Double Submit Prevented] Re-using previous submission for token: ${token}`);
      if (isAjax) {
        return res.json({ success: true, message: 'Your custom request has already been submitted!', requestNumber: prev.requestNumber });
      }
      req.flash('success', `Your custom request has already been submitted! Your request number is ${prev.requestNumber}.`);
      return res.redirect('/custom-order');
    }

    // 3. Normalize & sanitize inputs
    const cleanName = (name || full_name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').trim();
    const cleanTitle = (design_title || (design_type ? `${design_type} Design` : 'Custom Embroidery Request')).trim();
    const cleanDesc = (description || design_details || '').trim();
    
    // Normalize formats (can come from checkboxes or string)
    let formatsArr = [];
    if (Array.isArray(formats)) formatsArr = formats;
    else if (Array.isArray(preferred_formats)) formatsArr = preferred_formats;
    else if (typeof formats === 'string' && formats) formatsArr = [formats];
    else if (typeof preferred_formats === 'string' && preferred_formats) formatsArr = preferred_formats.split(',').map(s => s.trim());
    const cleanFormats = formatsArr.length > 0 ? formatsArr.join(', ') : 'DST, PES, JEF, EXP';

    // Normalize size
    let cleanSize = size_hoop ? String(size_hoop).trim() : null;
    if (!cleanSize && (width_mm || height_mm)) {
      cleanSize = `${width_mm || '?'}mm x ${height_mm || '?'}mm`;
    }

    // 4. Strict Validation (name, email, phone, description required; address NOT required)
    const fieldErrors = {};
    if (!cleanName || cleanName.length < 2) {
      fieldErrors.name = 'Please provide your full name (at least 2 characters).';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      fieldErrors.email = 'Please provide a valid email address.';
    }
    const digitsOnlyPhone = cleanPhone.replace(/\D/g, '');
    if (!cleanPhone || digitsOnlyPhone.length < 7) {
      fieldErrors.phone = 'Please provide a valid phone number (at least 7 digits).';
    }
    if (!cleanDesc || cleanDesc.length < 5) {
      fieldErrors.description = 'Please describe your design request (at least 5 characters).';
    }

    // 5. Handle Reference Image (Optional, Max 5MB, JPG/PNG/WEBP, real magic bytes check)
    let reference_image_key = null;
    if (req.file) {
      const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
      const fileExt = path.extname(req.file.originalname || '').toLowerCase();

      if (!allowedExts.includes(fileExt)) {
        fieldErrors.reference_image = 'Invalid file format. Only JPG, PNG, and WEBP image formats are supported.';
      } else if (req.file.size > 5 * 1024 * 1024) {
        fieldErrors.reference_image = 'Reference image exceeds 5 MB limit. Please upload an image under 5 MB.';
      } else if (!isValidImageBuffer(req.file.buffer)) {
        fieldErrors.reference_image = 'Uploaded file is not a valid image. Please select a genuine JPG, PNG, or WEBP image.';
      } else {
        // Persistent storage OUTSIDE the git code repository
        const uploadsDir = storage.getUploadsDir();
        const customRequestsDir = path.join(uploadsDir, 'private', 'custom-requests');
        if (!fs.existsSync(customRequestsDir)) {
          fs.mkdirSync(customRequestsDir, { recursive: true });
        }
        const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const safeFilename = `cr-${uniqueSuffix}${fileExt}`;
        const destPath = path.join(customRequestsDir, safeFilename);

        fs.writeFileSync(destPath, req.file.buffer);
        reference_image_key = `custom-requests/${safeFilename}`;
      }
    }

    // If validation errors exist, return friendly response with preserved fields
    if (Object.keys(fieldErrors).length > 0) {
      if (isAjax) {
        return res.status(400).json({
          success: false,
          errors: fieldErrors,
          message: Object.values(fieldErrors)[0]
        });
      }
      req.flash('error', Object.values(fieldErrors)[0]);
      req.flash('field_errors', fieldErrors);
      req.flash('form_data', req.body);
      return res.redirect('/custom-order');
    }

    // 6. Duplicate Submission Protection (60s window)
    const duplicate = await CustomRequest.findRecentDuplicate(cleanEmail, cleanDesc);
    if (duplicate) {
      console.log(`[Duplicate Submission Detected] Returning existing request ${duplicate.request_number}`);
      const dupMsg = `Your request has already been received! Your Request Number is ${duplicate.request_number}.`;
      if (isAjax) {
        return res.json({ success: true, message: dupMsg, requestNumber: duplicate.request_number });
      }
      req.flash('success', dupMsg);
      return res.redirect('/custom-order');
    }

    // 7. Save in Database Transaction
    const newRequest = await CustomRequest.create({
      userId: req.user ? req.user.id : null,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      design_title: cleanTitle,
      description: cleanDesc,
      category_id: category_id || null,
      preferred_formats: cleanFormats,
      size_hoop: cleanSize,
      budget: budget || null,
      deadline: deadline || null,
      reference_image_key,
      status: 'new'
    });

    // Record idempotency token in session
    if (token && req.session) {
      req.session.processedCustomTokens = req.session.processedCustomTokens || {};
      req.session.processedCustomTokens[token] = {
        requestNumber: newRequest.request_number,
        timestamp: Date.now()
      };
      // Regenerate idempotency token for next submission
      req.session.customOrderIdempotencyToken = crypto.randomBytes(16).toString('hex');
    }

    // 8. Notification Emails (Customer Confirmation + Admin Alert) in try/catch
    // NEVER fails the request even if email delivery fails or SMTP is unconfigured
    try {
      sendCustomerConfirmation(newRequest).catch(err => {
        console.warn('[Custom Order Email Notice] Non-fatal customer email error:', err.message);
      });
      sendAdminNotification(newRequest).catch(err => {
        console.warn('[Custom Order Email Notice] Non-fatal admin email error:', err.message);
      });
    } catch (emailErr) {
      console.warn('[Custom Order Email Notice] Unexpected email dispatch failure:', emailErr.message);
    }

    const successMessage = `Your custom embroidery request has been submitted! Your Request Number is ${newRequest.request_number}. Our master digitizers will review it and reply within 24 hours.`;

    if (isAjax) {
      return res.json({
        success: true,
        message: successMessage,
        requestNumber: newRequest.request_number
      });
    }

    req.flash('success', successMessage);
    res.redirect('/custom-order');
  } catch (err) {
    console.error('[Custom Order Submission Error]:', err.stack || err.message);

    const errorRef = 'CR_ERR_' + Date.now().toString(36).toUpperCase();
    if (isAjax) {
      return res.status(500).json({
        success: false,
        referenceId: errorRef,
        message: 'An unexpected error occurred while processing your request. Please try again or contact support.'
      });
    }

    req.flash('error', `An unexpected error occurred (Ref: ${errorRef}). Please try again or contact support.`);
    req.flash('form_data', req.body);
    res.redirect('/custom-order');
  }
};

exports.getFAQ = (req, res) => {
  res.render('pages/faq', {
    title: 'Frequently Asked Questions - ARUVI EMBROIDERY STUDIO'
  });
};

exports.getBlog = (req, res) => {
  res.render('pages/blog', {
    title: 'Blog & Embroidery Guides - ARUVI EMBROIDERY STUDIO'
  });
};

exports.getPrivacy = (req, res) => {
  res.render('pages/privacy', {
    title: 'Privacy Policy - ARUVI EMBROIDERY STUDIO'
  });
};

exports.getTerms = (req, res) => {
  res.render('pages/terms', {
    title: 'Terms & Conditions - ARUVI EMBROIDERY STUDIO'
  });
};

exports.getRefund = (req, res) => {
  res.render('pages/refund', {
    title: 'Refund Policy - ARUVI EMBROIDERY STUDIO'
  });
};

exports.getSitemap = async (req, res, next) => {
  try {
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const { designs } = await Design.getAll({ limit: 1000 });
    const categories = await Category.getAll();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    const staticPages = ['', '/designs', '/categories', '/custom-order', '/about', '/contact', '/faq', '/blog', '/privacy', '/terms', '/refund'];
    staticPages.forEach(p => {
      xml += `  <url><loc>${siteUrl}${p}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    });

    categories.forEach(c => {
      xml += `  <url><loc>${siteUrl}/category/${c.slug}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>\n`;
    });

    designs.forEach(d => {
      xml += `  <url><loc>${siteUrl}/design/${d.slug}</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>\n`;
    });

    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    next(err);
  }
};

const EmailCampaign = require('../models/EmailCampaign');

exports.getUnsubscribe = (req, res) => {
  const email = (req.query.email || '').trim();
  res.render('pages/unsubscribe', {
    title: 'Unsubscribe - ARUVI EMBROIDERY STUDIO',
    email,
    unsubscribed: false
  });
};

exports.postUnsubscribe = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (email && email.trim()) {
      await EmailCampaign.unsubscribe(email.trim());
    }
    res.render('pages/unsubscribe', {
      title: 'Unsubscribed - ARUVI EMBROIDERY STUDIO',
      email: email ? email.trim() : '',
      unsubscribed: true
    });
  } catch (err) {
    next(err);
  }
};

