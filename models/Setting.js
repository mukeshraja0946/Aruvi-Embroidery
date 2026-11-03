const db = require('../config/db');
const crypto = require('crypto');

function getEncryptionKey() {
  const secret = process.env.SESSION_SECRET || 'aruvi_embroidery_secret_stitch_key';
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(plainText) {
  if (!plainText || typeof plainText !== 'string') return '';
  if (plainText.startsWith('enc::')) return plainText;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `enc::${iv.toString('hex')}::${encrypted}`;
  } catch (e) {
    return plainText;
  }
}

function decryptSecret(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return '';
  if (!cipherText.startsWith('enc::')) return cipherText;
  try {
    const parts = cipherText.split('::');
    if (parts.length !== 3) return cipherText;
    const iv = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
    let decrypted = decipher.update(parts[2], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return cipherText;
  }
}

function maskSecret(secret) {
  if (!secret) return '';
  const clean = decryptSecret(secret);
  if (clean.length <= 4) return '••••••••';
  return '••••••••' + clean.slice(-4);
}

const defaultFeatureCards = {
  master: true,
  pages: {
    home: false,          // Default OFF for Home hero so hero stays clean
    custom_order: true,   // Default ON
    about: true,          // Default ON
    design_detail: true,  // Default ON
    contact: true,        // Default ON
    categories: true      // Default ON
  },
  cards: [
    {
      id: 'card_1',
      title: 'Premium Quality',
      subtitle: 'Crafted with precision',
      icon: 'fa-solid fa-award',
      enabled: true,
      link: '',
      order: 1
    },
    {
      id: 'card_2',
      title: 'Instant Download',
      subtitle: 'Get files immediately',
      icon: 'fa-solid fa-download',
      enabled: true,
      link: '',
      order: 2
    },
    {
      id: 'card_3',
      title: '100% Tested',
      subtitle: 'Quality assured designs',
      icon: 'fa-solid fa-shield-halved',
      enabled: true,
      link: '',
      order: 3
    },
    {
      id: 'card_4',
      title: 'Dedicated Support',
      subtitle: "We're here to help you",
      icon: 'fa-solid fa-headset',
      enabled: true,
      link: '',
      order: 4
    }
  ]
};

const fallbackSettings = {
  feature_cards: JSON.stringify(defaultFeatureCards),
  shop_name: 'ARUVI EMBROIDERY STUDIO',
  tagline: 'Where Threads Tell Stories',
  logo_url: '/public/assets/brand/logo.png',
  mobile_logo_url: '/public/assets/brand/logo.png',
  favicon_url: '/public/assets/brand/favicon.ico',
  hero_image: '/public/assets/brand/hero_embroidery.jpg',
  contact_email: process.env.CONTACT_EMAIL || 'aruviembroidery@gmail.com',
  contact_phone: process.env.CONTACT_PHONE || '',
  address: process.env.SHOP_ADDRESS || '',
  currency_symbol: '₹',
  announcement_bar: 'Premium Machine Embroidery Designs — DST, PES, JEF, EXP & More | Instant Download',
  facebook_url: 'https://facebook.com/aruviembroidery',
  instagram_url: 'https://instagram.com/aruviembroidery',
  pinterest_url: 'https://pinterest.com/aruviembroidery',
  youtube_url: 'https://youtube.com/aruviembroidery',
  upi_id: 'aruviembroidery@upi',
  upiId: 'aruviembroidery@upi',
  upi_name: 'ARUVI EMBROIDERY STUDIO',
  upiName: 'ARUVI EMBROIDERY STUDIO',
  upiMerchantName: 'ARUVI EMBROIDERY STUDIO',
  twitter_url: '',
  max_upload_zip_size_mb: '100',
  max_file_size_mb: '200',
  download_limit_per_file: '0',
  allow_multiple_files_per_design: '1',
  auto_detect_formats_policy: 'fill_if_empty',
  razorpay_key_id: process.env.RAZORPAY_KEY_ID || '',
  razorpay_key_secret: process.env.RAZORPAY_KEY_SECRET || '',
  razorpay_mode: process.env.RAZORPAY_MODE || (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'live' : 'test'),
  razorpay_webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  hide_empty_categories_in_pills: 'true',
  show_category_banner_mobile: '0',
  show_sku_on_cards: '0',
  about_hero_title: 'About ARUVI',
  about_hero_subtitle: 'Crafting Beautiful Designs for Your Creative Journey',
  about_hero_description: 'At ARUVI Embroidery Studio, we create high-quality machine embroidery designs that bring your ideas to life. Our designs are crafted with precision, creativity, and a passion for embroidery, helping individuals and businesses create beautiful, professional embroidery projects.',
  about_story_title: 'A Passion for Embroidery',
  about_story_p1: 'ARUVI Embroidery Studio started with a simple idea — to make high-quality embroidery designs accessible to everyone. What began as a passion for creativity and design has now grown into a trusted platform for thousands of embroidery enthusiasts around the world.',
  about_story_p2: 'We believe embroidery is more than just a craft — it\'s a way to express creativity, culture, and individuality. Our mission is to provide unique, high-quality, and easy-to-use machine embroidery designs that help you bring your creative ideas to life.',
  about_stats_mode: 'auto',
  about_stat1_num: '10,000+',
  about_stat1_label: 'Happy Customers',
  about_stat2_num: '5,000+',
  about_stat2_label: 'Unique Designs',
  about_stat3_num: '50+',
  about_stat3_label: 'Countries Worldwide',
  about_stat4_num: '4.9/5',
  about_stat4_label: 'Customer Rating',
  about_mission_title: 'Our Mission',
  about_mission_text: 'To deliver high-quality, creative, and reliable embroidery designs that inspire and support embroidery creators worldwide.',
  about_vision_title: 'Our Vision',
  about_vision_text: 'To become a global leader in machine embroidery designs, known for quality, creativity, and excellent customer support.',
  about_values_title: 'Our Values',
  about_values_text: 'Quality, Creativity, Customer Satisfaction and Continuous Innovation.',
  show_about_story_image: '0',
  about_story_image: '',
  show_contact_map: '0',
  contact_address_line: '',
  contact_map_image: '',
  feature_card1_title: 'Premium Quality',
  feature_card1_subtitle: 'Crafted with precision',
  feature_card1_icon: 'fa-solid fa-award',
  feature_card2_title: 'Instant Download',
  feature_card2_subtitle: 'Get files immediately',
  feature_card2_icon: 'fa-solid fa-download',
  feature_card3_title: '100% Tested',
  feature_card3_subtitle: 'Quality assured designs',
  feature_card3_icon: 'fa-solid fa-shield-halved',
  feature_card4_title: 'Dedicated Support',
  feature_card4_subtitle: "We're here to help you",
  feature_card4_icon: 'fa-solid fa-headset',
  stitch_number_format: 'indian',
  show_stitch_front: '1',
  label_stitch_front: 'Stitch Count (Front)',
  show_stitch_back: '1',
  label_stitch_back: 'Stitch Count (Back)',
  show_stitch_sleeve: '1',
  label_stitch_sleeve: 'Stitch Count (Sleeve)',
  show_stitch_total: '1',
  label_stitch_total: 'Total Stitch Count',
  show_stitch_on_cards: '0',
  require_checkout_address: '0',
  watermark_enabled: '0',
  watermark_position: 'center',
  watermark_opacity: '25',
  preloader_enabled: '1',
  preloader_style: 'stitching_hexagon',
  preloader_speed: 'normal',
  preloader_min_time: '900',
  preloader_max_time: '3500',
  preloader_exit_effect: 'fade',
  preloader_frequency: 'session',
  preloader_show_tagline: '1',
  preloader_color_primary: '#4B0F1C',
  preloader_color_secondary: '#C7876C',
  preloader_color_rose: '#BB4558',
  preloader_color_bg: '#F8E8E2',
  preloader_color_thread: '#EFC09B',
  preloader_color_stitch: '#911628',
  preloader_custom_url: ''
};

class Setting {
  static getDefaultFeatureCardsConfig() {
    return JSON.parse(JSON.stringify(defaultFeatureCards));
  }

  static parseFeatureCards(raw) {
    let parsed = null;
    if (raw && typeof raw === 'object') {
      parsed = raw;
    } else if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        parsed = null;
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      parsed = Setting.getDefaultFeatureCardsConfig();
    }

    const toBoolean = (val, defaultVal = false) => {
      if (val === undefined || val === null) return defaultVal;
      if (val === true || val === 1 || val === '1' || val === 'true' || val === 'on') return true;
      if (val === false || val === 0 || val === '0' || val === 'false' || val === 'off') return false;
      return Boolean(val);
    };

    const master = toBoolean(parsed.master, true);

    const defaultPages = {
      home: false,
      custom_order: true,
      about: true,
      design_detail: true,
      contact: true,
      categories: true
    };
    const incomingPages = (parsed.pages && typeof parsed.pages === 'object') ? parsed.pages : {};
    const pages = {
      home: toBoolean(incomingPages.home, defaultPages.home),
      custom_order: toBoolean(incomingPages.custom_order, defaultPages.custom_order),
      about: toBoolean(incomingPages.about, defaultPages.about),
      design_detail: toBoolean(incomingPages.design_detail, defaultPages.design_detail),
      contact: toBoolean(incomingPages.contact, defaultPages.contact),
      categories: toBoolean(incomingPages.categories, defaultPages.categories)
    };

    const cleanText = (str, maxLen) => {
      if (str === null || str === undefined) return '';
      return String(str).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
    };

    const cleanIcon = (iconStr, fallbackIcon) => {
      if (!iconStr || typeof iconStr !== 'string') return fallbackIcon;
      const trimmed = iconStr.trim();
      // Whitelist format: fa-solid fa-xxx or fa-xxx (alphanumeric and dashes only)
      if (/^fa-(solid|regular|brands)\s+fa-[a-z0-9-]+$/i.test(trimmed)) {
        return trimmed;
      }
      if (/^[a-z0-9- ]+$/i.test(trimmed) && !/[<>"'`;()]/.test(trimmed)) {
        return trimmed;
      }
      return fallbackIcon;
    };

    const defaultList = defaultFeatureCards.cards;
    const incomingCards = Array.isArray(parsed.cards) ? parsed.cards : [];

    const cards = defaultList.map((defCard, idx) => {
      const found = incomingCards.find(c => c && String(c.id).trim() === String(defCard.id).trim()) || incomingCards[idx] || {};
      const enabled = found.enabled !== undefined ? toBoolean(found.enabled, defCard.enabled) : defCard.enabled;
      const title = cleanText(found.title !== undefined ? found.title : defCard.title, 40) || defCard.title;
      const subtitle = cleanText(found.subtitle !== undefined ? found.subtitle : defCard.subtitle, 80);
      const icon = cleanIcon(found.icon !== undefined ? found.icon : defCard.icon, defCard.icon);
      const link = cleanText(found.link !== undefined ? found.link : '', 255);
      const order = Number(found.order) || (idx + 1);

      return {
        id: defCard.id,
        title,
        subtitle,
        icon,
        enabled,
        link,
        order
      };
    });

    cards.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    return {
      master,
      pages,
      cards
    };
  }

  static getFeatureCards(page = null, settingsSource = null) {
    let raw = null;
    if (settingsSource && settingsSource.feature_cards) {
      raw = settingsSource.feature_cards;
    } else if (fallbackSettings.feature_cards) {
      raw = fallbackSettings.feature_cards;
    }

    const config = Setting.parseFeatureCards(raw);

    if (!config.master) {
      return [];
    }

    if (page) {
      const pageKey = String(page).toLowerCase().trim().replace(/[-\s]/g, '_');
      if (config.pages && config.pages[pageKey] === false) {
        return [];
      }
    }

    return (config.cards || [])
      .filter(c => c && c.enabled !== false)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }

  static syncAliases(key, value) {
    fallbackSettings[key] = String(value);

    // Maintain key alias mappings for frontend/API backwards compatibility
    if (key === 'upi_id') fallbackSettings['upiId'] = String(value);
    if (key === 'upiId') fallbackSettings['upi_id'] = String(value);

    if (key === 'upi_name') {
      fallbackSettings['upiName'] = String(value);
      fallbackSettings['upiMerchantName'] = String(value);
    }
    if (key === 'upiName' || key === 'upiMerchantName') {
      fallbackSettings['upi_name'] = String(value);
      fallbackSettings['upiName'] = String(value);
      fallbackSettings['upiMerchantName'] = String(value);
    }
  }

  static async get(key, defaultValue = null) {
    try {
      if (db.isConnected()) {
        const rows = await db.query('SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1', [key]);
        if (Array.isArray(rows) && rows.length > 0 && rows[0].setting_value !== null && rows[0].setting_value !== undefined) {
          return rows[0].setting_value;
        }
      }
    } catch (err) {
      console.warn(`[Setting.get error for ${key}]:`, err.message);
    }
    if (fallbackSettings[key] !== undefined) {
      return fallbackSettings[key];
    }
    return defaultValue;
  }

  static async getDecrypted(key, defaultValue = null) {
    const val = await Setting.get(key, defaultValue);
    return decryptSecret(val);
  }

  static async getRazorpayConfig() {
    let keyId = await Setting.get('razorpay_key_id');
    let keySecretRaw = await Setting.get('razorpay_key_secret');
    let mode = await Setting.get('razorpay_mode');
    let webhookSecretRaw = await Setting.get('razorpay_webhook_secret');

    // Fallbacks to process.env if not set in DB
    if (!keyId && process.env.RAZORPAY_KEY_ID) keyId = process.env.RAZORPAY_KEY_ID;
    if (!keySecretRaw && process.env.RAZORPAY_KEY_SECRET) keySecretRaw = process.env.RAZORPAY_KEY_SECRET;
    if (!webhookSecretRaw && process.env.RAZORPAY_WEBHOOK_SECRET) webhookSecretRaw = process.env.RAZORPAY_WEBHOOK_SECRET;

    keyId = (keyId || '').trim();
    const keySecret = decryptSecret((keySecretRaw || '').trim());
    const webhookSecret = decryptSecret((webhookSecretRaw || '').trim());

    if (!mode || (mode !== 'test' && mode !== 'live')) {
      mode = keyId.startsWith('rzp_live') ? 'live' : 'test';
    }

    const isConfigured = Boolean(keyId && keySecret && !keyId.includes('samplekey'));
    const isRealKey = isConfigured;

    return {
      keyId,
      keySecret,
      webhookSecret,
      mode,
      isConfigured,
      isRealKey
    };
  }

  static async getAll() {
    try {
      if (db.isConnected()) {
        const rows = await db.query('SELECT setting_key, setting_value FROM settings');
        if (Array.isArray(rows) && rows.length > 0) {
          rows.forEach(r => {
            if (r.setting_key && r.setting_value !== null && r.setting_value !== undefined) {
              Setting.syncAliases(r.setting_key, r.setting_value);
            }
          });
        }
      }
    } catch (err) {
      console.error('[Setting.getAll error]:', err.message);
    }
    const storage = require('../config/storage');
    const resolved = { ...fallbackSettings };
    resolved.logo_url = storage.resolveBrandAsset('logo', resolved.logo_url);
    resolved.mobile_logo_url = storage.resolveBrandAsset('mobile_logo', resolved.mobile_logo_url);
    resolved.favicon_url = storage.resolveBrandAsset('favicon', resolved.favicon_url);
    resolved.hero_image = storage.resolveBrandAsset('hero_image', resolved.hero_image);

    // Provide masked secrets for admin form
    resolved.razorpay_key_secret_masked = maskSecret(resolved.razorpay_key_secret);
    resolved.razorpay_webhook_secret_masked = maskSecret(resolved.razorpay_webhook_secret);

    return resolved;
  }

  static async updateAll(settingsData) {
    if (!settingsData || typeof settingsData !== 'object') return true;

    // Process secrets: encrypt if provided, skip if masked placeholders
    const payload = { ...settingsData };
    if (payload.razorpay_key_secret !== undefined) {
      const trimmed = String(payload.razorpay_key_secret).trim();
      if (trimmed.startsWith('••••') || !trimmed) {
        delete payload.razorpay_key_secret;
      } else {
        payload.razorpay_key_secret = encryptSecret(trimmed);
      }
    }
    if (payload.razorpay_webhook_secret !== undefined) {
      const trimmed = String(payload.razorpay_webhook_secret).trim();
      if (trimmed.startsWith('••••') || !trimmed) {
        delete payload.razorpay_webhook_secret;
      } else {
        payload.razorpay_webhook_secret = encryptSecret(trimmed);
      }
    }

    // Process feature_cards structured configuration with bidirectional sync
    if (payload.feature_cards !== undefined) {
      const parsedConfig = Setting.parseFeatureCards(payload.feature_cards);
      payload.feature_cards = JSON.stringify(parsedConfig);

      // Keep legacy individual card keys in sync
      const cardMap = {};
      (parsedConfig.cards || []).forEach(c => { cardMap[c.id] = c; });
      if (cardMap['card_1']) {
        payload.feature_card1_title = cardMap['card_1'].title;
        payload.feature_card1_subtitle = cardMap['card_1'].subtitle;
        payload.feature_card1_icon = cardMap['card_1'].icon;
      }
      if (cardMap['card_2']) {
        payload.feature_card2_title = cardMap['card_2'].title;
        payload.feature_card2_subtitle = cardMap['card_2'].subtitle;
        payload.feature_card2_icon = cardMap['card_2'].icon;
      }
      if (cardMap['card_3']) {
        payload.feature_card3_title = cardMap['card_3'].title;
        payload.feature_card3_subtitle = cardMap['card_3'].subtitle;
        payload.feature_card3_icon = cardMap['card_3'].icon;
      }
      if (cardMap['card_4']) {
        payload.feature_card4_title = cardMap['card_4'].title;
        payload.feature_card4_subtitle = cardMap['card_4'].subtitle;
        payload.feature_card4_icon = cardMap['card_4'].icon;
      }
    } else if (
      payload.feature_card1_title !== undefined ||
      payload.feature_card2_title !== undefined ||
      payload.feature_card3_title !== undefined ||
      payload.feature_card4_title !== undefined
    ) {
      // Legacy form submission without explicit feature_cards: update feature_cards in sync
      const currentConfig = Setting.parseFeatureCards(fallbackSettings.feature_cards);
      if (payload.feature_card1_title !== undefined && currentConfig.cards[0]) {
        currentConfig.cards[0].title = String(payload.feature_card1_title).replace(/<[^>]*>/g, '').trim().slice(0, 40);
        if (payload.feature_card1_subtitle !== undefined) currentConfig.cards[0].subtitle = String(payload.feature_card1_subtitle).replace(/<[^>]*>/g, '').trim().slice(0, 80);
        if (payload.feature_card1_icon !== undefined) currentConfig.cards[0].icon = String(payload.feature_card1_icon).trim();
      }
      if (payload.feature_card2_title !== undefined && currentConfig.cards[1]) {
        currentConfig.cards[1].title = String(payload.feature_card2_title).replace(/<[^>]*>/g, '').trim().slice(0, 40);
        if (payload.feature_card2_subtitle !== undefined) currentConfig.cards[1].subtitle = String(payload.feature_card2_subtitle).replace(/<[^>]*>/g, '').trim().slice(0, 80);
        if (payload.feature_card2_icon !== undefined) currentConfig.cards[1].icon = String(payload.feature_card2_icon).trim();
      }
      if (payload.feature_card3_title !== undefined && currentConfig.cards[2]) {
        currentConfig.cards[2].title = String(payload.feature_card3_title).replace(/<[^>]*>/g, '').trim().slice(0, 40);
        if (payload.feature_card3_subtitle !== undefined) currentConfig.cards[2].subtitle = String(payload.feature_card3_subtitle).replace(/<[^>]*>/g, '').trim().slice(0, 80);
        if (payload.feature_card3_icon !== undefined) currentConfig.cards[2].icon = String(payload.feature_card3_icon).trim();
      }
      if (payload.feature_card4_title !== undefined && currentConfig.cards[3]) {
        currentConfig.cards[3].title = String(payload.feature_card4_title).replace(/<[^>]*>/g, '').trim().slice(0, 40);
        if (payload.feature_card4_subtitle !== undefined) currentConfig.cards[3].subtitle = String(payload.feature_card4_subtitle).replace(/<[^>]*>/g, '').trim().slice(0, 80);
        if (payload.feature_card4_icon !== undefined) currentConfig.cards[3].icon = String(payload.feature_card4_icon).trim();
      }
      payload.feature_cards = JSON.stringify(currentConfig);
    }

    // 1. Synchronize in-memory fallback settings immediately
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) {
        Setting.syncAliases(key, value);
      }
    }

    // 2. Persist to MySQL database table settings
    try {
      if (db.isConnected()) {
        for (const [key, value] of Object.entries(payload)) {
          if (value !== undefined && value !== null) {
            const strVal = String(value);
            await db.query(
              'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
              [key, strVal, strVal]
            );

            // Save aliases explicitly to DB as well for SQL query consistency
            if (key === 'upi_id') {
              await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['upiId', strVal, strVal]);
            }
            if (key === 'upi_name') {
              await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['upiMerchantName', strVal, strVal]);
            }
          }
        }
      }
    } catch (err) {
      console.error('[Setting.updateAll DB error]:', err.message);
    }
    return true;
  }

  static async set(key, value) {
    return this.updateAll({ [key]: String(value) });
  }
}


Setting.encryptSecret = encryptSecret;
Setting.decryptSecret = decryptSecret;
Setting.maskSecret = maskSecret;

module.exports = Setting;
