const nodemailer = require('nodemailer');

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.mailtrap.io';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || user === 'your_smtp_user' || user === 'your_smtp_username') {
    return null; // SMTP credentials not set
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass
    }
  });
}

/**
 * 1. Test SMTP Connection
 */
async function testSmtpConnection() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || user === 'your_smtp_user') {
    return {
      success: false,
      message: 'SMTP credentials (SMTP_USER/SMTP_PASS) are not configured in backend environment.'
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  try {
    await transporter.verify();
    return {
      success: true,
      message: `SMTP connection and authentication successful! (Server: ${host}:${port})`
    };
  } catch (err) {
    console.error('[SMTP Test Error]:', err.message);
    return {
      success: false,
      message: `SMTP Connection/Auth Failed: ${err.message}`
    };
  }
}

/**
 * 2. Send New Design Email
 */
async function sendNewDesignEmail(design, recipientEmail = null) {
  try {
    const transporter = getTransporter();
    const from = process.env.EMAIL_FROM || '"Aruvi Embroidery" <noreply@aruviembroidery.com>';
    const appUrl = process.env.APP_URL || process.env.SITE_URL || 'http://localhost:3000';
    const recipient = recipientEmail || process.env.SMTP_USER || 'customer@aruviembroidery.com';

    const title = design.title || 'New Embroidery Design';
    const formats = design.formats || 'DST';
    const price = parseFloat(design.sale_price || design.price || 45).toFixed(2);
    const designUrl = `${appUrl}/design/${design.slug || design.id}`;

    if (!transporter) {
      console.log(`[Email Notice] SMTP not configured. Skipped sending New Design email for "${title}".`);
      return { success: false, simulated: true, message: 'SMTP credentials not configured.' };
    }

    const mailOptions = {
      from,
      to: recipient,
      subject: `New Embroidery Design Added – Aruvi Embroidery`,
      text: `Hello,\n\nA new embroidery design has been added to Aruvi Embroidery.\n\nDesign:\n${title}\n\nAvailable formats:\n${formats}\n\nPrice:\n₹${price}\n\nYou can view the new design on our website.\n\nRegards,\nAruvi Embroidery\nWhere Threads Tell Stories`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background: #231815; color: #FFF; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 1.6rem;">Aruvi Embroidery</h1>
            <p style="margin: 5px 0 0; font-size: 0.9rem; color: #E5C396; font-style: italic;">Where Threads Tell Stories</p>
          </div>
          <div style="padding: 24px;">
            <p>Hello,</p>
            <p>A new embroidery design has been added to Aruvi Embroidery.</p>
            <div style="background: #FAF6F0; border-left: 4px solid #A87C4F; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0 0 8px;"><strong>Design:</strong> ${title}</p>
              <p style="margin: 0 0 8px;"><strong>Available formats:</strong> ${formats}</p>
              <p style="margin: 0;"><strong>Price:</strong> ₹${price}</p>
            </div>
            <p><a href="${designUrl}" style="display: inline-block; background: #A87C4F; color: #FFF; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">View New Design</a></p>
            <p style="margin-top: 30px;">Regards,<br><strong>Aruvi Embroidery</strong><br><em>Where Threads Tell Stories</em></p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [New Design Email Sent] Sent for "${title}" to ${recipient}`);
    return { success: true };
  } catch (err) {
    console.error('[New Design Email Error]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 3. Send Design Update Email
 */
async function sendDesignUpdateEmail(design, recipientEmail = null) {
  try {
    const transporter = getTransporter();
    const from = process.env.EMAIL_FROM || '"Aruvi Embroidery" <noreply@aruviembroidery.com>';
    const appUrl = process.env.APP_URL || process.env.SITE_URL || 'http://localhost:3000';
    const recipient = recipientEmail || process.env.SMTP_USER || 'customer@aruviembroidery.com';

    const title = design.title || 'AED 01';
    const designUrl = `${appUrl}/design/${design.slug || design.id}`;

    if (!transporter) {
      console.log(`[Email Notice] SMTP not configured. Skipped sending Design Update email for "${title}".`);
      return { success: false, simulated: true, message: 'SMTP credentials not configured.' };
    }

    const mailOptions = {
      from,
      to: recipient,
      subject: `Design Updated – ${title}`,
      text: `Hello,\n\nThe embroidery design ${title} has been updated on Aruvi Embroidery.\n\nPlease visit our website to view the latest information.\n\nRegards,\nAruvi Embroidery\nWhere Threads Tell Stories`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background: #231815; color: #FFF; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 1.6rem;">Aruvi Embroidery</h1>
            <p style="margin: 5px 0 0; font-size: 0.9rem; color: #E5C396; font-style: italic;">Where Threads Tell Stories</p>
          </div>
          <div style="padding: 24px;">
            <p>Hello,</p>
            <p>The embroidery design <strong>${title}</strong> has been updated on Aruvi Embroidery.</p>
            <p>Please visit our website to view the latest information.</p>
            <p><a href="${designUrl}" style="display: inline-block; background: #A87C4F; color: #FFF; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Design</a></p>
            <p style="margin-top: 30px;">Regards,<br><strong>Aruvi Embroidery</strong><br><em>Where Threads Tell Stories</em></p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [Design Update Email Sent] Sent for "${title}" to ${recipient}`);
    return { success: true };
  } catch (err) {
    console.error('[Design Update Email Error]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 4. Send Successful Purchase Email
 * MUST ONLY be called AFTER server-side Razorpay signature verification and successful order completion.
 */
async function sendPurchaseConfirmationEmail(order) {
  try {
    const transporter = getTransporter();
    const from = process.env.EMAIL_FROM || '"Aruvi Embroidery" <noreply@aruviembroidery.com>';
    const appUrl = process.env.APP_URL || process.env.SITE_URL || 'http://localhost:3000';

    const customerName = order.guest_name || order.user_name || 'Customer';
    const customerEmail = order.guest_email || order.user_email || 'customer@aruviembroidery.com';

    let designName = 'Embroidery Design';
    if (order.items && order.items.length > 0) {
      designName = order.items.map(i => i.title).join(', ');
    }

    const orderId = order.order_number || `AE-${order.id}`;
    const amount = parseFloat(order.final_amount || 0).toFixed(2);
    const downloadUrl = `${appUrl}/account/downloads`;

    if (!transporter) {
      console.log(`[Email Simulation Notice] Purchase email simulated for Order ${orderId} to ${customerEmail}. SMTP credentials missing.`);
      return { success: false, simulated: true, message: 'SMTP credentials not configured.' };
    }

    const mailOptions = {
      from,
      to: customerEmail,
      subject: `Purchase Successful – ${designName} | Aruvi Embroidery`,
      text: `Hello ${customerName},\n\nThank you for your purchase from Aruvi Embroidery.\n\nYou have successfully purchased:\n${designName}\n\nYour payment has been successfully received.\n\nYour purchased design is now available for download from your account.\n\nDownload:\n${downloadUrl}\n\nOrder ID:\n${orderId}\n\nAmount:\n₹${amount}\n\nPayment Status:\nPaid\n\nRegards,\nAruvi Embroidery\nWhere Threads Tell Stories`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background: #231815; color: #FFF; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 1.6rem;">Aruvi Embroidery</h1>
            <p style="margin: 5px 0 0; font-size: 0.9rem; color: #E5C396; font-style: italic;">Where Threads Tell Stories</p>
          </div>
          <div style="padding: 24px;">
            <p>Hello ${customerName},</p>
            <p>Thank you for your purchase from Aruvi Embroidery.</p>
            <p>You have successfully purchased:</p>
            <h3 style="color: #231815; margin: 10px 0;">${designName}</h3>
            <p>Your payment has been successfully received.</p>
            <p>Your purchased design is now available for download from your account.</p>

            <div style="background: #FAF6F0; border-left: 4px solid #2E7D32; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0 0 6px;"><strong>Order ID:</strong> ${orderId}</p>
              <p style="margin: 0 0 6px;"><strong>Amount:</strong> ₹${amount}</p>
              <p style="margin: 0;"><strong>Payment Status:</strong> <span style="color: #2E7D32; font-weight: bold;">Paid</span></p>
            </div>

            <p><a href="${downloadUrl}" style="display: inline-block; background: #2E7D32; color: #FFF; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Open My Downloads</a></p>

            <p style="margin-top: 30px;">Regards,<br><strong>Aruvi Embroidery</strong><br><em>Where Threads Tell Stories</em></p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [Purchase Email Sent] Confirmation sent for Order #${orderId} to ${customerEmail}`);
    return { success: true };
  } catch (err) {
    console.error('[Purchase Email Error]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 5. Send Custom Campaign Email to Individual Recipient
 */
async function sendCampaignEmail({ to, toName, subject, htmlBody, unsubscribeUrl }) {
  try {
    const transporter = getTransporter();
    const fromName = process.env.EMAIL_FROM_NAME || 'Aruvi Embroidery';
    const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'aruviembroidery@gmail.com';
    const fromHeader = `"${fromName}" <${fromEmail}>`;

    if (!transporter) {
      console.log(`[Email Simulation Notice] Campaign email simulated to ${to}. Subject: "${subject}".`);
      return { success: true, simulated: true };
    }

    const cleanName = toName || 'Valued Customer';
    const finalUnsubUrl = unsubscribeUrl || 'https://aruviembroidery.com/unsubscribe';

    // Wrap body content with professional branding & unsubscribe footer
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin:0; padding:0; background-color:#F7F3EC; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; color:#231815;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F7F3EC; padding: 20px 0;">
          <tr>
            <td align="center">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.06); border:1px solid #E8E0D5;">
                <!-- Header -->
                <tr>
                  <td align="center" style="background-color:#231815; padding: 25px 20px;">
                    <h1 style="color:#FFFFFF; font-size:1.6rem; margin:0; font-family:Georgia, serif; letter-spacing:1px;">Aruvi Embroidery</h1>
                    <p style="color:#E5C396; font-size:0.85rem; margin:4px 0 0 0; font-style:italic;">Where Threads Tell Stories</p>
                  </td>
                </tr>
                <!-- Body Content -->
                <tr>
                  <td style="padding: 30px 28px; line-height:1.6; font-size:0.95rem; color:#231815;">
                    ${htmlBody}
                  </td>
                </tr>
                <!-- Footer -->
                <tr>
                  <td align="center" style="background-color:#FAF6F0; padding: 20px 28px; border-top:1px solid #E8E0D5; font-size:0.78rem; color:#776A62;">
                    <p style="margin:0 0 8px 0; font-weight:bold;">ARUVI EMBROIDERY STUDIO</p>
                    <p style="margin:0 0 10px 0;">Erode, Tamil Nadu, 638001, India | <a href="mailto:aruviembroidery@gmail.com" style="color:#B8402A; text-decoration:none;">aruviembroidery@gmail.com</a></p>
                    <p style="margin:0; color:#998B82;">
                      You received this email because you registered on Aruvi Embroidery. 
                      <a href="${finalUnsubUrl}" style="color:#B8402A; text-decoration:underline;">Unsubscribe from marketing emails</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const plainText = htmlBody.replace(/<[^>]+>/g, '').trim();

    const mailOptions = {
      from: fromHeader,
      to: to,
      subject: subject,
      text: plainText,
      html: fullHtml
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [Campaign Email Sent] To: ${to} | Subject: "${subject}"`);
    return { success: true };
  } catch (err) {
    console.error(`❌ [Campaign Email Error] To: ${to} | Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  testSmtpConnection,
  sendNewDesignEmail,
  sendDesignUpdateEmail,
  sendPurchaseConfirmationEmail,
  sendCampaignEmail
};

