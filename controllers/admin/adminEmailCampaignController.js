const EmailCampaign = require('../../models/EmailCampaign');
const User = require('../../models/User');
const emailService = require('../../services/emailService');

/**
 * Helper: Check if request is AJAX
 */
function isAjaxRequest(req) {
  return (
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes('json')) ||
    (req.headers['content-type'] && req.headers['content-type'].includes('json'))
  );
}

class AdminEmailCampaignController {
  /**
   * 1. Render Email Campaigns Management Page
   */
  static async getCampaignsPage(req, res) {
    try {
      const page = parseInt(req.query.page || 1);
      const { campaigns, total } = await EmailCampaign.getAll({ page, limit: 20 });
      const rawCustomersList = await User.getAllCustomers();

      // Filter eligible customers (non-admin, valid email)
      const rawCustomers = rawCustomersList ? rawCustomersList.filter(u => u.role !== 'admin' && u.email && u.email.includes('@')) : [];

      // Attach unsubscribe status dynamically
      const customers = [];
      for (const c of rawCustomers) {
        const unsub = await EmailCampaign.isUnsubscribed(c.email);
        customers.push({
          id: c.id,
          full_name: c.full_name || 'Customer',
          email: c.email,
          created_at: c.created_at,
          is_unsubscribed: unsub
        });
      }

      // Calculate aggregated statistics
      let totalSent = 0;
      let totalSuccess = 0;
      let totalFailed = 0;

      campaigns.forEach(c => {
        totalSent += (c.total_recipients || 0);
        totalSuccess += (c.success_count || 0);
        totalFailed += (c.failed_count || 0);
      });

      const deliveryRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 100;

      res.render('admin/email-campaigns/index', {
        title: 'Email Campaigns - ARUVI Admin',
        campaigns,
        customers,
        total,
        stats: {
          totalCampaigns: total || campaigns.length,
          totalSent,
          totalSuccess,
          totalFailed,
          deliveryRate
        },
        activeTab: 'campaigns',
        csrfToken: req.csrfToken ? req.csrfToken() : '',
        flash: req.flash()
      });
    } catch (err) {
      console.error('getCampaignsPage error:', err.message);
      req.flash('error', 'Error loading email campaigns: ' + err.message);
      res.redirect('/admin');
    }
  }

  /**
   * 2. JSON Endpoint to Fetch Recipient Customer List
   */
  static async getRecipients(req, res) {
    try {
      const rawCustomersList = await User.getAllCustomers();
      const rawCustomers = rawCustomersList ? rawCustomersList.filter(u => u.role !== 'admin' && u.email && u.email.includes('@')) : [];

      const customers = [];
      for (const c of rawCustomers) {
        const unsub = await EmailCampaign.isUnsubscribed(c.email);
        customers.push({
          id: c.id,
          full_name: c.full_name || 'Customer',
          email: c.email,
          is_unsubscribed: unsub
        });
      }

      res.json({ success: true, customers, count: customers.length });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * 3. Save Campaign Draft
   */
  static async saveDraft(req, res) {
    try {
      const { subject, body_html } = req.body;

      if (!subject || !subject.trim()) {
        return res.status(400).json({ success: false, message: 'Email Subject is required.' });
      }

      const campaignId = await EmailCampaign.createDraft({
        subject: subject.trim(),
        body_html: body_html || ''
      });

      res.json({
        success: true,
        message: 'Campaign draft saved successfully.',
        campaignId
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * 4. Send Test Email
   */
  static async sendTestEmail(req, res) {
    try {
      const { test_email, subject, body_html } = req.body;

      const recipient = (test_email && test_email.trim())
        ? test_email.trim()
        : (process.env.SMTP_USER || 'aruviembroidery@gmail.com');

      if (!recipient || !recipient.includes('@')) {
        return res.status(400).json({ success: false, message: 'Please enter a valid test email address.' });
      }

      if (!subject || !subject.trim()) {
        return res.status(400).json({ success: false, message: 'Email Subject is required.' });
      }

      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const unsubUrl = `${appUrl}/unsubscribe?email=${encodeURIComponent(recipient)}`;

      const result = await emailService.sendCampaignEmail({
        to: recipient,
        toName: 'Test Recipient',
        subject: `[TEST] ${subject.trim()}`,
        htmlBody: body_html || '<p>Test email body content.</p>',
        unsubscribeUrl: unsubUrl
      });

      if (result.success) {
        return res.json({
          success: true,
          message: `Test email successfully sent to ${recipient}!`,
          simulated: Boolean(result.simulated)
        });
      } else {
        return res.status(500).json({
          success: false,
          message: `Failed to send test email: ${result.error || 'SMTP Error'}`
        });
      }
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * 5. Dispatch Main Email Campaign to Selected or All Customers
   */
  static async sendCampaign(req, res) {
    try {
      const { subject, body_html, target, selected_emails } = req.body;

      if (!subject || !subject.trim()) {
        return res.status(400).json({ success: false, message: 'Email Subject is required.' });
      }

      if (!body_html || !body_html.trim()) {
        return res.status(400).json({ success: false, message: 'Email Content Message is required.' });
      }

      // Fetch all registered customers
      const rawCustomersList = await User.getAllCustomers();
      const rawCustomers = rawCustomersList ? rawCustomersList.filter(u => u.role !== 'admin' && u.email && u.email.includes('@')) : [];

      let candidateList = [];

      if (target === 'selected' && Array.isArray(selected_emails) && selected_emails.length > 0) {
        const emailSet = new Set(selected_emails.map(e => e.toLowerCase().trim()));
        candidateList = rawCustomers.filter(c => emailSet.has(c.email.toLowerCase().trim()));
      } else {
        candidateList = [...rawCustomers];
      }

      // Deduplicate & Exclude Unsubscribed
      const finalRecipients = [];
      const seenEmails = new Set();

      for (const c of candidateList) {
        const cleanEmail = c.email.toLowerCase().trim();
        if (seenEmails.has(cleanEmail)) continue;

        const isUnsub = await EmailCampaign.isUnsubscribed(cleanEmail);
        if (!isUnsub) {
          seenEmails.add(cleanEmail);
          finalRecipients.push({
            id: c.id,
            name: c.full_name || 'Valued Customer',
            email: cleanEmail
          });
        }
      }

      if (finalRecipients.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No eligible recipients found. Selected customers may be unsubscribed or invalid.'
        });
      }

      // Create Campaign Record & Recipient Logs
      const campaignId = await EmailCampaign.createCampaign({
        subject: subject.trim(),
        body_html: body_html.trim(),
        recipients: finalRecipients
      });

      const appUrl = process.env.APP_URL || 'http://localhost:3000';

      let successCount = 0;
      let failedCount = 0;

      // Dispatch individual emails with rate limiting delay
      for (const recipient of finalRecipients) {
        const unsubUrl = `${appUrl}/unsubscribe?email=${encodeURIComponent(recipient.email)}`;

        const result = await emailService.sendCampaignEmail({
          to: recipient.email,
          toName: recipient.name,
          subject: subject.trim(),
          htmlBody: body_html.trim(),
          unsubscribeUrl: unsubUrl
        });

        if (result.success) {
          successCount++;
          await EmailCampaign.updateRecipientLog(campaignId, recipient.email, 'Sent', null);
        } else {
          failedCount++;
          await EmailCampaign.updateRecipientLog(campaignId, recipient.email, 'Failed', result.error || 'SMTP Sending Error');
        }

        // 50ms delay between sends to respect SMTP rate limits
        await new Promise(r => setTimeout(r, 50));
      }

      // Determine final campaign status
      let finalStatus = 'Completed';
      if (failedCount > 0 && successCount > 0) {
        finalStatus = 'Partially Failed';
      } else if (failedCount > 0 && successCount === 0) {
        finalStatus = 'Failed';
      }

      await EmailCampaign.updateCampaignStatus(campaignId, finalStatus, successCount, failedCount);

      res.json({
        success: true,
        message: `Campaign dispatch completed! ${successCount} sent successfully, ${failedCount} failed.`,
        campaignId,
        status: finalStatus,
        successCount,
        failedCount,
        total: finalRecipients.length
      });
    } catch (err) {
      console.error('sendCampaign error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * 6. Retry Failed Recipients for a Campaign
   */
  static async retryFailed(req, res) {
    try {
      const { campaignId } = req.body;
      const campaign = await EmailCampaign.getById(campaignId);

      if (!campaign) {
        return res.status(404).json({ success: false, message: 'Campaign not found.' });
      }

      const failedRecipients = await EmailCampaign.getFailedRecipients(campaignId);

      if (!failedRecipients || failedRecipients.length === 0) {
        return res.json({ success: true, message: 'No failed recipients to retry for this campaign.' });
      }

      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      let retriedSuccess = 0;
      let retriedFailed = 0;

      for (const r of failedRecipients) {
        const unsubUrl = `${appUrl}/unsubscribe?email=${encodeURIComponent(r.recipient_email)}`;

        const result = await emailService.sendCampaignEmail({
          to: r.recipient_email,
          toName: r.recipient_name || 'Customer',
          subject: campaign.subject,
          htmlBody: campaign.body_html,
          unsubscribeUrl: unsubUrl
        });

        if (result.success) {
          retriedSuccess++;
          await EmailCampaign.updateRecipientLog(campaignId, r.recipient_email, 'Sent', null);
        } else {
          retriedFailed++;
          await EmailCampaign.updateRecipientLog(campaignId, r.recipient_email, 'Failed', result.error || 'Retry SMTP Error');
        }

        await new Promise(res => setTimeout(res, 50));
      }

      // Re-query campaign logs to get updated total counts
      const updatedCampaign = await EmailCampaign.getById(campaignId);
      const logs = updatedCampaign.logs || [];
      const newSuccess = logs.filter(l => l.status === 'Sent').length;
      const newFailed = logs.filter(l => l.status === 'Failed').length;

      let newStatus = 'Completed';
      if (newFailed > 0 && newSuccess > 0) newStatus = 'Partially Failed';
      else if (newFailed > 0 && newSuccess === 0) newStatus = 'Failed';

      await EmailCampaign.updateCampaignStatus(campaignId, newStatus, newSuccess, newFailed);

      res.json({
        success: true,
        message: `Retry completed! ${retriedSuccess} succeeded, ${retriedFailed} still failed.`,
        newSuccess,
        newFailed,
        status: newStatus
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * 7. Fetch Campaign Details & Recipient Logs
   */
  static async getCampaignDetails(req, res) {
    try {
      const { id } = req.params;
      const campaign = await EmailCampaign.getById(id);

      if (!campaign) {
        return res.status(404).json({ success: false, message: 'Campaign not found.' });
      }

      res.json({ success: true, campaign });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * 8. Delete Campaign
   */
  /**
   * 8. Delete Campaign
   */
  static async deleteCampaign(req, res) {
    try {
      const { id } = req.params;
      await EmailCampaign.delete(id);
      res.json({ success: true, message: 'Campaign record deleted successfully.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * 9. Save Gmail App Password & Test Connection
   */
  static async saveSmtpConfig(req, res) {
    const fs = require('fs');
    const path = require('path');
    try {
      const { smtp_user, smtp_pass, smtp_host, smtp_port } = req.body;
      const cleanUser = (smtp_user && smtp_user.trim()) ? smtp_user.trim() : (process.env.SMTP_USER || 'aruviembroidery@gmail.com');
      const cleanPass = (smtp_pass && smtp_pass.trim()) ? smtp_pass.trim() : '';

      if (!cleanPass) {
        return res.status(400).json({ success: false, message: 'Google App Password (16 characters) is required.' });
      }

      // Update .env file safely
      const envPath = path.join(__dirname, '../../.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

      const updateEnvVar = (key, val) => {
        const reg = new RegExp(`^${key}=.*$`, 'm');
        if (reg.test(envContent)) {
          envContent = envContent.replace(reg, `${key}=${val}`);
        } else {
          envContent += `\n${key}=${val}`;
        }
      };

      const finalHost = smtp_host || 'smtp.gmail.com';
      const finalPort = String(smtp_port || '587');

      updateEnvVar('SMTP_HOST', finalHost);
      updateEnvVar('SMTP_PORT', finalPort);
      updateEnvVar('SMTP_SECURE', 'false');
      updateEnvVar('SMTP_USER', cleanUser);
      updateEnvVar('SMTP_PASS', cleanPass);
      updateEnvVar('EMAIL_FROM_NAME', 'Aruvi Embroidery');
      updateEnvVar('EMAIL_FROM', cleanUser);

      fs.writeFileSync(envPath, envContent, 'utf8');

      // Reload process.env memory variables
      process.env.SMTP_HOST = finalHost;
      process.env.SMTP_PORT = finalPort;
      process.env.SMTP_SECURE = 'false';
      process.env.SMTP_USER = cleanUser;
      process.env.SMTP_PASS = cleanPass;
      process.env.EMAIL_FROM_NAME = 'Aruvi Embroidery';
      process.env.EMAIL_FROM = cleanUser;

      // Test connection with Gmail SMTP
      const testRes = await emailService.testSmtpConnection();

      if (testRes.success) {
        return res.json({
          success: true,
          message: 'Gmail App Password configured and SMTP authentication successful!',
          testResult: testRes
        });
      } else {
        return res.status(400).json({
          success: false,
          message: `App Password saved, but SMTP Authentication Failed: ${testRes.message}`,
          testResult: testRes
        });
      }
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to update SMTP config: ' + err.message });
    }
  }

  /**
   * 10. Test SMTP Connection Only
   */
  static async testSmtpConnectionApi(req, res) {
    try {
      const testRes = await emailService.testSmtpConnection();
      res.json(testRes);
    } catch (err) {
      res.status(500).json({ success: false, message: 'SMTP Test Error: ' + err.message });
    }
  }
}

module.exports = AdminEmailCampaignController;
