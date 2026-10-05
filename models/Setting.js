const db = require('../config/db');

const fallbackSettings = {
  shop_name: 'ARUVI EMBROIDERY STUDIO',
  tagline: 'Where Threads Tell Stories',
  logo_url: '/public/images/logo.jpg',
  mobile_logo_url: '/public/images/logo.jpg',
  favicon_url: '/public/images/logo.jpg',
  contact_email: 'aruviembroidery@gmail.com',
  contact_phone: '+91 98765 43210',
  address: 'Erode, Tamil Nadu, 638001, India',
  currency_symbol: '₹',
  announcement_bar: 'Premium Machine Embroidery Designs — DST, PES, JEF, EXP & More | Instant Download',
  facebook_url: 'https://facebook.com/aruviembroidery',
  instagram_url: 'https://instagram.com/aruviembroidery',
  linkedin_url: 'https://linkedin.com/company/aruviembroidery',
  youtube_url: 'https://youtube.com/aruviembroidery',
  upi_id: 'aruviembroidery@upi',
  upiId: 'aruviembroidery@upi',
  upi_name: 'ARUVI EMBROIDERY STUDIO',
  upiName: 'ARUVI EMBROIDERY STUDIO',
  upiMerchantName: 'ARUVI EMBROIDERY STUDIO',
  bank_name: 'State Bank of India',
  bankName: 'State Bank of India',
  account_number: '39849201928',
  accountNumber: '39849201928',
  ifsc_code: 'SBIN0001234',
  ifscCode: 'SBIN0001234',
  account_holder: 'ARUVI EMBROIDERY STUDIO',
  accountHolder: 'ARUVI EMBROIDERY STUDIO',
  accountHolderName: 'ARUVI EMBROIDERY STUDIO',
  pinterest_url: '',
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

    if (key === 'bank_name') fallbackSettings['bankName'] = String(value);
    if (key === 'bankName') fallbackSettings['bank_name'] = String(value);

    if (key === 'account_number') fallbackSettings['accountNumber'] = String(value);
    if (key === 'accountNumber') fallbackSettings['account_number'] = String(value);

    if (key === 'ifsc_code') fallbackSettings['ifscCode'] = String(value);
    if (key === 'ifscCode') fallbackSettings['ifsc_code'] = String(value);

    if (key === 'account_holder') {
      fallbackSettings['accountHolder'] = String(value);
      fallbackSettings['accountHolderName'] = String(value);
    }
    if (key === 'accountHolder' || key === 'accountHolderName') {
      fallbackSettings['account_holder'] = String(value);
      fallbackSettings['accountHolder'] = String(value);
      fallbackSettings['accountHolderName'] = String(value);
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
          if (key === 'bank_name') {
            await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['bankName', strVal, strVal]);
          }
          if (key === 'account_number') {
            await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['accountNumber', strVal, strVal]);
          }
          if (key === 'ifsc_code') {
            await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['ifscCode', strVal, strVal]);
          }
          if (key === 'account_holder') {
            await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['accountHolderName', strVal, strVal]);
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
