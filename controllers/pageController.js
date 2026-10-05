const ContactMessage = require('../models/ContactMessage');
const CustomOrder = require('../models/CustomOrder');
const Design = require('../models/Design');
const Category = require('../models/Category');

exports.getAbout = (req, res) => {
  res.render('pages/about', {
    title: 'About Us - ARUVI EMBROIDERY STUDIO'
  });
};

exports.getContact = (req, res) => {
  res.render('pages/contact', {
    title: 'Get in Touch - ARUVI EMBROIDERY STUDIO'
  });
};

exports.postContact = async (req, res, next) => {
  try {
    const { name, email, message } = req.body;
    await ContactMessage.create({ name, email, subject: 'Customer Inquiry', message });

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

    const staticPages = ['', '/designs', '/categories', '/custom-order', '/about', '/contact', '/faq', '/privacy', '/terms', '/refund'];
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
