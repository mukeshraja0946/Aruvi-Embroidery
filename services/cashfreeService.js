const crypto = require('crypto');
const http = require('http');
const https = require('https');
const dotenv = require('dotenv');
dotenv.config();

const appId = (process.env.CASHFREE_APP_ID || '').trim();
const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
const environment = (process.env.CASHFREE_ENVIRONMENT || 'sandbox').trim().toLowerCase();
const appUrl = (process.env.APP_URL || process.env.SITE_URL || 'http://localhost:3000').trim().replace(/\/$/, '');

// Requirement 26: Startup Validation
if (!appId || !secretKey) {
  console.warn('\n====================================================');
  console.warn('⚠️ [Cashfree Configuration Warning]:');
  console.warn('CASHFREE_APP_ID or CASHFREE_SECRET_KEY is missing in backend .env.');
  console.warn('Please fill CASHFREE_APP_ID and CASHFREE_SECRET_KEY in backend .env.');
  console.warn('====================================================\n');
}

const getBaseUrl = () => {
  return environment === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
};

/**
 * Helper to make HTTPS requests to Cashfree API v3
 */
function makeCashfreeApiRequest(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const baseUrlStr = getBaseUrl();
    const fullUrl = new URL(baseUrlStr + endpoint);

    const postData = data ? JSON.stringify(data) : '';

    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || 443,
      path: fullUrl.pathname + fullUrl.search,
      method: method.toUpperCase(),
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode, data: parsed });
          } else {
            resolve({ success: false, statusCode: res.statusCode, data: parsed });
          }
        } catch (e) {
          resolve({ success: false, statusCode: res.statusCode, raw: body, error: e.message });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Requirement 5, 7, 9: Create Cashfree Order
 */
async function createOrder({
  orderId,
  amount,
  currency = 'INR',
  customer = {},
  returnUrl = null,
  notifyUrl = null
}) {
  const formattedAmount = parseFloat(parseFloat(amount).toFixed(2));
  const finalReturnUrl = returnUrl || `${appUrl}/checkout/cashfree-return?order_id={order_id}`;
  const finalNotifyUrl = notifyUrl || `${appUrl}/api/payment/cashfree/webhook`;

  const payload = {
    order_id: String(orderId),
    order_amount: formattedAmount,
    order_currency: currency,
    customer_details: {
      customer_id: String(customer.id || 'cust_' + Date.now()),
      customer_name: customer.name || 'Aruvi Customer',
      customer_email: customer.email || 'customer@example.com',
      customer_phone: (customer.phone || '9876543210').replace(/\D/g, '').slice(-10) || '9876543210'
    },
    order_meta: {
      return_url: finalReturnUrl,
      notify_url: finalNotifyUrl
    }
  };

  // If credentials are present, call real Cashfree API
  if (appId && secretKey && !appId.includes('YOUR_CASHFREE')) {
    const response = await makeCashfreeApiRequest('/orders', 'POST', payload);
    if (response.success && response.data && response.data.payment_session_id) {
      return {
        success: true,
        cfOrderId: response.data.order_id,
        paymentSessionId: response.data.payment_session_id,
        environment,
        data: response.data
      };
    } else {
      console.error('[Cashfree API Error]:', response);
      return {
        success: false,
        message: (response.data && response.data.message) || 'Failed to create Cashfree payment session',
        details: response.data
      };
    }
  }

  // Sandbox simulation mode when credentials not yet set in .env
  console.log('[Cashfree Simulation]: Running in sandbox simulation mode...');
  return {
    success: true,
    cfOrderId: String(orderId),
    paymentSessionId: `session_sim_${Date.now()}_${Math.random().toString(36).substring(2,8)}`,
    environment: 'sandbox',
    isSimulation: true
  };
}

/**
 * Requirement 11: Verify / Fetch Order status from Cashfree
 */
async function fetchOrder(cfOrderId) {
  if (appId && secretKey && !appId.includes('YOUR_CASHFREE')) {
    const response = await makeCashfreeApiRequest(`/orders/${cfOrderId}`, 'GET');
    if (response.success && response.data) {
      return {
        success: true,
        status: response.data.order_status, // 'PAID', 'ACTIVE', 'EXPIRED', 'FAILED'
        amount: response.data.order_amount,
        currency: response.data.order_currency,
        orderId: response.data.order_id,
        data: response.data
      };
    } else {
      return {
        success: false,
        message: (response.data && response.data.message) || 'Failed to fetch Cashfree order status'
      };
    }
  }

  // Simulation mode
  return {
    success: true,
    status: 'PAID',
    amount: null,
    currency: 'INR',
    orderId: cfOrderId,
    isSimulation: true
  };
}

/**
 * Requirement 10: Verify Cashfree Webhook Signature
 */
function verifyWebhookSignature(rawBody, timestamp, signature) {
  if (!secretKey) return false;
  try {
    const dataToSign = timestamp + rawBody;
    const computedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToSign)
      .digest('base64');
    return computedSignature === signature;
  } catch (err) {
    console.error('[Cashfree Webhook Signature Error]:', err.message);
    return false;
  }
}

module.exports = {
  createOrder,
  fetchOrder,
  verifyWebhookSignature,
  getEnvironment: () => environment,
  getAppId: () => appId,
  isConfigured: () => Boolean(appId && secretKey && !appId.includes('YOUR_CASHFREE'))
};
