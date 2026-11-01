const nodemailer = require('nodemailer');

function getSenderEmail() {
  return (process.env.SMTP_USER || 'aruviembroidery@gmail.com').toLowerCase().trim();
}

function getSenderName() {
  return (process.env.EMAIL_FROM_NAME || 'Aruvi Embroidery').trim();
}

function getSenderHeader() {
  return `"${getSenderName()}" <${getSenderEmail()}>`;
}

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = getSenderEmail();
  const pass = process.env.SMTP_PASS;

  if (!user || !pass || pass === 'YOUR_GMAIL_APP_PASSWORD' || pass === 'your_smtp_password' || user === 'your_smtp_user') {
    return null; // SMTP credentials not configured
  }

  const isSecure = process.env.SMTP_SECURE === 'true' || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure: isSecure,
    requireTLS: !isSecure,
    auth: { user, pass }
  });
}

/**
 * Send customer confirmation email for custom design request
 */
async function sendCustomerConfirmation(request) {
  try {
    const transporter = getTransporter();
    if (!transporter) {
      console.log(`[Email Notice] SMTP not configured. Skipped sending customer confirmation for ${request.request_number}.`);
      return { success: false, simulated: true };
    }

    const appUrl = process.env.APP_URL || process.env.SITE_URL || 'https://aruviembroidery.com';
    const mailOptions = {
      from: getSenderHeader(),
      to: request.email,
      subject: `[${request.request_number}] Your Custom Embroidery Request Received - Aruvi Embroidery`,
      text: `Hello ${request.name},\n\nThank you for requesting a custom embroidery design with Aruvi Embroidery!\n\nYour Request Details:\n- Request Number: ${request.request_number}\n- Design Title: ${request.design_title}\n- Preferred Formats: ${request.preferred_formats || 'DST, PES, JEF, EXP'}\n\nOur master digitizers will review your request and get back to you with a price quote and turnaround estimate within 24 hours.\n\nYou can track updates on our website: ${appUrl}\n\nRegards,\nAruvi Embroidery Studio\nWhere Threads Tell Stories`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #E8E0D5; border-radius: 12px; overflow: hidden; background: #FFFFFF;">
          <div style="background: #231815; color: #FFF; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 1.6rem; color: #FAF6F0; font-family: 'Playfair Display', Georgia, serif;">Aruvi Embroidery</h1>
            <p style="margin: 6px 0 0; font-size: 0.9rem; color: #C7876C; font-style: italic;">Where Threads Tell Stories</p>
          </div>
          <div style="padding: 28px;">
            <h2 style="font-size: 1.25rem; color: #231815; margin-top: 0;">Hello ${escapeHtml(request.name)},</h2>
            <p style="font-size: 0.95rem; color: #555;">Thank you for requesting a custom embroidery design! We have received your submission and our master digitizers have begun reviewing your specifications.</p>
            
            <div style="background: #FAF6F0; border-left: 4px solid #4B0F1C; padding: 18px 20px; margin: 22px 0; border-radius: 8px;">
              <p style="margin: 0 0 10px; font-size: 0.9rem;"><strong>Request Number:</strong> <span style="color: #4B0F1C; font-weight: 700;">${escapeHtml(request.request_number)}</span></p>
              <p style="margin: 0 0 10px; font-size: 0.9rem;"><strong>Design Title:</strong> ${escapeHtml(request.design_title)}</p>
              <p style="margin: 0 0 10px; font-size: 0.9rem;"><strong>Preferred Formats:</strong> ${escapeHtml(request.preferred_formats || 'DST, PES, JEF, EXP')}</p>
              ${request.size_hoop ? `<p style="margin: 0 0 10px; font-size: 0.9rem;"><strong>Size / Hoop:</strong> ${escapeHtml(request.size_hoop)}</p>` : ''}
              ${request.budget ? `<p style="margin: 0 0 10px; font-size: 0.9rem;"><strong>Target Budget:</strong> ₹${escapeHtml(String(request.budget))}</p>` : ''}
              <p style="margin: 0; font-size: 0.9rem;"><strong>Status:</strong> <span style="background: #E8F5E9; color: #2E7D32; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 0.82rem;">Received (Under Review)</span></p>
            </div>

            <h3 style="font-size: 1rem; color: #231815; margin-bottom: 8px;">What Happens Next?</h3>
            <ol style="font-size: 0.9rem; color: #666; padding-left: 20px; line-height: 1.8;">
              <li>Our digitizing team assesses the artwork complexity and stitch layout.</li>
              <li>We will email you a quote and estimated delivery timeline within <strong>24 hours</strong>.</li>
              <li>Once approved and paid, your design is digitized, test-sewn, and delivered in your required formats.</li>
            </ol>

            <p style="margin-top: 30px; font-size: 0.85rem; color: #777; border-top: 1px solid #E8E0D5; padding-top: 16px;">
              Have questions or need to add more details? Simply reply to this email or contact us at <a href="mailto:${getSenderEmail()}" style="color: #4B0F1C;">${getSenderEmail()}</a>.
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [Custom Order Email] Confirmation sent to ${request.email} for ${request.request_number}`);
    return { success: true };
  } catch (err) {
    console.warn(`⚠️ [Custom Order Email Notice] Failed to send customer email to ${request.email}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Send admin alert email for newly submitted custom request
 */
async function sendAdminNotification(request) {
  try {
    const transporter = getTransporter();
    if (!transporter) {
      console.log(`[Email Notice] SMTP not configured. Skipped sending admin alert for ${request.request_number}.`);
      return { success: false, simulated: true };
    }

    const adminEmail = process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL || getSenderEmail();
    const appUrl = process.env.APP_URL || process.env.SITE_URL || 'https://aruviembroidery.com';
    const adminLink = `${appUrl}/admin/custom-orders`;

    const mailOptions = {
      from: getSenderHeader(),
      to: adminEmail,
      subject: `🚨 [New Custom Order] ${request.request_number} from ${request.name}`,
      text: `New Custom Embroidery Request Received!\n\nRequest Number: ${request.request_number}\nCustomer: ${request.name} (${request.email}, ${request.phone})\nDesign: ${request.design_title}\nDescription:\n${request.description}\n\nView and manage in Admin: ${adminLink}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #E8E0D5; border-radius: 12px; overflow: hidden; background: #FFFFFF;">
          <div style="background: #4B0F1C; color: #FFF; padding: 20px; text-align: center;">
            <h2 style="margin: 0; font-size: 1.4rem; color: #FAF6F0;">New Custom Design Request</h2>
            <p style="margin: 4px 0 0; font-size: 0.85rem; color: #EFC09B;">Request #${escapeHtml(request.request_number)}</p>
          </div>
          <div style="padding: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
              <tr>
                <td style="padding: 8px 0; color: #777; width: 140px;">Customer Name:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #231815;">${escapeHtml(request.name)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #777;">Email:</td>
                <td style="padding: 8px 0;"><a href="mailto:${escapeHtml(request.email)}" style="color: #4B0F1C;">${escapeHtml(request.email)}</a></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #777;">Phone:</td>
                <td style="padding: 8px 0; font-weight: 600;">${escapeHtml(request.phone || 'N/A')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #777;">Design Title:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #231815;">${escapeHtml(request.design_title)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #777;">Preferred Formats:</td>
                <td style="padding: 8px 0;">${escapeHtml(request.preferred_formats || 'DST, PES, JEF, EXP')}</td>
              </tr>
              ${request.size_hoop ? `<tr><td style="padding: 8px 0; color: #777;">Size / Hoop:</td><td style="padding: 8px 0;">${escapeHtml(request.size_hoop)}</td></tr>` : ''}
              ${request.budget ? `<tr><td style="padding: 8px 0; color: #777;">Budget:</td><td style="padding: 8px 0; font-weight: 600; color: #2E7D32;">₹${escapeHtml(String(request.budget))}</td></tr>` : ''}
              ${request.deadline ? `<tr><td style="padding: 8px 0; color: #777;">Deadline:</td><td style="padding: 8px 0;">${escapeHtml(String(request.deadline))}</td></tr>` : ''}
            </table>

            <div style="margin: 18px 0; background: #FAF6F0; border-radius: 8px; padding: 14px 16px;">
              <strong style="display: block; margin-bottom: 6px; font-size: 0.85rem; color: #4B0F1C;">Customer Description:</strong>
              <p style="margin: 0; font-size: 0.88rem; white-space: pre-wrap; color: #333;">${escapeHtml(request.description)}</p>
            </div>

            <p style="text-align: center; margin-top: 24px;">
              <a href="${adminLink}" style="display: inline-block; background: #4B0F1C; color: #FFF; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 0.9rem;">
                Open Admin Custom Orders
              </a>
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [Custom Order Email] Admin alert sent to ${adminEmail} for ${request.request_number}`);
    return { success: true };
  } catch (err) {
    console.warn(`⚠️ [Custom Order Email Notice] Failed to send admin alert: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  sendCustomerConfirmation,
  sendAdminNotification
};
