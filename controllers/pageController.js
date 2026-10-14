const ContactMessage = require('../models/ContactMessage');
const CustomOrder = require('../models/CustomOrder');
const Design = require('../models/Design');
const Category = require('../models/Category');

const Setting = require('../models/Setting');
const db = require('../config/db');

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

exports.getCustomOrder = (req, res) => {
  res.render('pages/custom-order', {
    title: 'Request a Custom Design - ARUVI EMBROIDERY STUDIO'
  });
};

exports.postCustomOrder = async (req, res, next) => {
  try {
    const { full_name, email, phone, design_details } = req.body;
    let reference_image_url = null;

    if (req.file) {
      reference_image_url = `/public/uploads/previews/${req.file.filename}`;
    }

    await CustomOrder.create({
      userId: req.user ? req.user.id : null,
      full_name,
      email,
      phone,
      design_details,
      reference_image_url
    });

    req.flash('success', 'Your custom embroidery request has been submitted! Our master digitizers will review it and reply within 24 hours.');
    res.redirect('/custom-order');
  } catch (err) {
    next(err);
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

