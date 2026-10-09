const db = require('../config/db');

// Fallback in-memory store for offline database mode
let fallbackCampaigns = [
  {
    id: 1,
    subject: 'Welcome to Aruvi Embroidery Studio!',
    body_html: `
      <p>Hello Customer,</p>
      <p>Welcome to <strong>Aruvi Embroidery</strong>! Explore high-precision digitized embroidery designs crafted for passionate makers.</p>
      <p><a href="https://aruviembroidery.com/" style="display:inline-block; background:#B8402A; color:#FFF; padding:10px 20px; text-decoration:none; border-radius:6px; font-weight:bold;">Explore Designs</a></p>
      <p>Best regards,<br>Team Aruvi Embroidery</p>
    `,
    total_recipients: 1,
    success_count: 1,
    failed_count: 0,
    status: 'Completed',
    sent_at: new Date(),
    created_at: new Date()
  }
];

let fallbackLogs = [
  {
    id: 1,
    campaign_id: 1,
    recipient_email: 'customer@aruviembroidery.com',
    recipient_name: 'Priya Lakshmi',
    status: 'Sent',
    error_message: null,
    sent_at: new Date(),
    created_at: new Date()
  }
];

let fallbackUnsubscribed = new Set();

class EmailCampaign {
  // Ensure tables exist dynamically
  static async initTables() {
    if (!db.isConnected()) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS email_campaigns (
          id INT AUTO_INCREMENT PRIMARY KEY,
          subject VARCHAR(255) NOT NULL,
          body_html LONGTEXT NOT NULL,
          total_recipients INT DEFAULT 0,
          success_count INT DEFAULT 0,
          failed_count INT DEFAULT 0,
          status ENUM('Draft', 'Queued', 'Sending', 'Completed', 'Partially Failed', 'Failed') DEFAULT 'Draft',
          sent_at DATETIME DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS email_campaign_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          campaign_id INT NOT NULL,
          recipient_email VARCHAR(150) NOT NULL,
          recipient_name VARCHAR(100) DEFAULT NULL,
          status ENUM('Pending', 'Sent', 'Failed') DEFAULT 'Pending',
          error_message TEXT DEFAULT NULL,
          sent_at DATETIME DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_campaign_id (campaign_id),
          FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS unsubscribed_customers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(150) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    } catch (err) {
      console.warn('[EmailCampaign.initTables Notice]:', err.message);
    }
  }

  static async isUnsubscribed(email) {
    if (!email) return false;
    const cleanEmail = email.toLowerCase().trim();

    if (db.isConnected()) {
      try {
        await this.initTables();
        const rows = await db.query('SELECT id FROM unsubscribed_customers WHERE email = ? LIMIT 1', [cleanEmail]);
        return rows && rows.length > 0;
      } catch (err) {
        console.error('isUnsubscribed error:', err.message);
      }
    }
    return fallbackUnsubscribed.has(cleanEmail);
  }

  static async unsubscribe(email) {
    if (!email) return false;
    const cleanEmail = email.toLowerCase().trim();

    if (db.isConnected()) {
      try {
        await this.initTables();
        await db.query('INSERT IGNORE INTO unsubscribed_customers (email) VALUES (?)', [cleanEmail]);
        return true;
      } catch (err) {
        console.error('unsubscribe error:', err.message);
      }
    }
    fallbackUnsubscribed.add(cleanEmail);
    return true;
  }

  static async createDraft({ subject, body_html }) {
    if (db.isConnected()) {
      try {
        await this.initTables();
        const res = await db.query(
          'INSERT INTO email_campaigns (subject, body_html, total_recipients, success_count, failed_count, status) VALUES (?, ?, 0, 0, 0, "Draft")',
          [subject, body_html]
        );
        return res.insertId;
      } catch (err) {
        console.error('createDraft error:', err.message);
      }
    }

    const newId = fallbackCampaigns.length + 1;
    const draft = {
      id: newId,
      subject,
      body_html,
      total_recipients: 0,
      success_count: 0,
      failed_count: 0,
      status: 'Draft',
      sent_at: null,
      created_at: new Date()
    };
    fallbackCampaigns.unshift(draft);
    return newId;
  }

  static async createCampaign({ subject, body_html, recipients }) {
    const total = recipients.length;

    if (db.isConnected()) {
      try {
        await this.initTables();
        const res = await db.query(
          'INSERT INTO email_campaigns (subject, body_html, total_recipients, success_count, failed_count, status, sent_at) VALUES (?, ?, ?, 0, 0, "Sending", NOW())',
          [subject, body_html, total]
        );
        const campaignId = res.insertId;

        for (const r of recipients) {
          await db.query(
            'INSERT INTO email_campaign_logs (campaign_id, recipient_email, recipient_name, status) VALUES (?, ?, ?, "Pending")',
            [campaignId, r.email.toLowerCase().trim(), r.name || null]
          );
        }

        return campaignId;
      } catch (err) {
        console.error('createCampaign error:', err.message);
      }
    }

    const campaignId = fallbackCampaigns.length + 1;
    const campaign = {
      id: campaignId,
      subject,
      body_html,
      total_recipients: total,
      success_count: 0,
      failed_count: 0,
      status: 'Sending',
      sent_at: new Date(),
      created_at: new Date()
    };
    fallbackCampaigns.unshift(campaign);

    recipients.forEach((r, idx) => {
      fallbackLogs.push({
        id: fallbackLogs.length + 1,
        campaign_id: campaignId,
        recipient_email: r.email.toLowerCase().trim(),
        recipient_name: r.name || null,
        status: 'Pending',
        error_message: null,
        sent_at: null,
        created_at: new Date()
      });
    });

    return campaignId;
  }

  static async updateRecipientLog(campaignId, email, status, errorMessage = null) {
    const cleanEmail = email.toLowerCase().trim();
    if (db.isConnected()) {
      try {
        await db.query(
          'UPDATE email_campaign_logs SET status = ?, error_message = ?, sent_at = NOW() WHERE campaign_id = ? AND recipient_email = ?',
          [status, errorMessage, campaignId, cleanEmail]
        );
      } catch (err) {
        console.error('updateRecipientLog error:', err.message);
      }
    } else {
      const log = fallbackLogs.find(l => l.campaign_id == campaignId && l.recipient_email === cleanEmail);
      if (log) {
        log.status = status;
        log.error_message = errorMessage;
        log.sent_at = new Date();
      }
    }
  }

  static async updateCampaignStatus(campaignId, status, successCount, failedCount) {
    if (db.isConnected()) {
      try {
        await db.query(
          'UPDATE email_campaigns SET status = ?, success_count = ?, failed_count = ?, updated_at = NOW() WHERE id = ?',
          [status, successCount, failedCount, campaignId]
        );
      } catch (err) {
        console.error('updateCampaignStatus error:', err.message);
      }
    } else {
      const c = fallbackCampaigns.find(item => item.id == campaignId);
      if (c) {
        c.status = status;
        c.success_count = successCount;
        c.failed_count = failedCount;
      }
    }
  }

  static async getAll({ page = 1, limit = 20 } = {}) {
    if (db.isConnected()) {
      try {
        await this.initTables();
        const offset = (page - 1) * limit;
        const campaigns = await db.query(
          'SELECT * FROM email_campaigns ORDER BY id DESC LIMIT ? OFFSET ?',
          [parseInt(limit), parseInt(offset)]
        );
        const countRes = await db.query('SELECT COUNT(*) as total FROM email_campaigns');
        const total = (countRes && countRes[0] && countRes[0].total !== undefined) ? countRes[0].total : campaigns.length;

        return { campaigns, total };
      } catch (err) {
        console.error('getAll campaigns error:', err.message);
      }
    }
    return { campaigns: fallbackCampaigns, total: fallbackCampaigns.length };
  }

  static async getById(id) {
    if (db.isConnected()) {
      try {
        await this.initTables();
        const rows = await db.query('SELECT * FROM email_campaigns WHERE id = ? LIMIT 1', [id]);
        if (rows && rows[0]) {
          const campaign = rows[0];
          campaign.logs = await db.query('SELECT * FROM email_campaign_logs WHERE campaign_id = ? ORDER BY id ASC', [id]);
          return campaign;
        }
      } catch (err) {
        console.error('getById campaign error:', err.message);
      }
    }

    const c = fallbackCampaigns.find(item => item.id == id);
    if (!c) return null;
    const logs = fallbackLogs.filter(l => l.campaign_id == id);
    return { ...c, logs };
  }

  static async getFailedRecipients(campaignId) {
    if (db.isConnected()) {
      try {
        const rows = await db.query(
          'SELECT recipient_email, recipient_name FROM email_campaign_logs WHERE campaign_id = ? AND status = "Failed"',
          [campaignId]
        );
        return rows || [];
      } catch (err) {
        console.error('getFailedRecipients error:', err.message);
      }
    }

    return fallbackLogs
      .filter(l => l.campaign_id == campaignId && l.status === 'Failed')
      .map(l => ({ recipient_email: l.recipient_email, recipient_name: l.recipient_name }));
  }

  static async delete(id) {
    if (db.isConnected()) {
      try {
        await db.query('DELETE FROM email_campaigns WHERE id = ?', [id]);
        return true;
      } catch (err) {
        console.error('delete campaign error:', err.message);
      }
    }

    const idx = fallbackCampaigns.findIndex(c => c.id == id);
    if (idx !== -1) fallbackCampaigns.splice(idx, 1);
    fallbackLogs = fallbackLogs.filter(l => l.campaign_id != id);
    return true;
  }
}

module.exports = EmailCampaign;
