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

const fallbackSettings = {
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
  require_checkout_address: '0'
};

class Setting {
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
