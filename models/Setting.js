const db = require('../config/db');

const fallbackSettings = {
  shop_name: 'ARUVI EMBROIDERY STUDIO',
  tagline: 'Where Threads Tell Stories',
  logo_url: '/public/uploads/previews/logo_image-1791088249075-882339975.png',
  mobile_logo_url: '/public/uploads/previews/logo_image-1791088249075-882339975.png',
  favicon_url: '/public/uploads/previews/logo_image-1791088249075-882339975.png',
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
  twitter_url: ''
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

  static async getAll() {
    try {
      const rows = await db.query('SELECT setting_key, setting_value FROM settings');
      if (Array.isArray(rows) && rows.length > 0) {
        rows.forEach(r => {
          if (r.setting_key && r.setting_value !== null && r.setting_value !== undefined) {
            Setting.syncAliases(r.setting_key, r.setting_value);
          }
        });
      }
    } catch (err) {
      console.error('[Setting.getAll error]:', err.message);
    }
    return { ...fallbackSettings };
  }

  static async updateAll(settingsData) {
    if (!settingsData || typeof settingsData !== 'object') return true;

    // 1. Synchronize in-memory fallback settings immediately
    for (const [key, value] of Object.entries(settingsData)) {
      if (value !== undefined && value !== null) {
        Setting.syncAliases(key, value);
      }
    }

    // 2. Persist to MySQL database table settings
    try {
      for (const [key, value] of Object.entries(settingsData)) {
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
    } catch (err) {
      console.error('[Setting.updateAll DB error]:', err.message);
    }
    return true;
  }
}

module.exports = Setting;
