const axios = require('axios');

const MPESA_ENV = process.env.MPESA_ENVIRONMENT || 'sandbox';
const BASE_URL = MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// Get OAuth token
async function getAccessToken() {
  const consumer_key = process.env.MPESA_CONSUMER_KEY;
  const consumer_secret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumer_key || !consumer_secret) {
    throw new Error('M-Pesa credentials not configured');
  }

  const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString('base64');

  const response = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 10000
  });

  return response.data.access_token;
}

// Generate password for STK push
function generatePassword(shortcode, passkey, timestamp) {
  const str = `${shortcode}${passkey}${timestamp}`;
  return Buffer.from(str).toString('base64');
}

// Format phone number to 254XXXXXXXXX
function formatPhone(phone) {
  let cleaned = phone.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  if (cleaned.startsWith('+254')) cleaned = cleaned.slice(1);
  if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
  return cleaned;
}

// Initiate STK Push
async function initiateSTKPush({ phone, amount, packageName, accountRef }) {
  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE || '174379';
  const passkey = process.env.MPESA_PASSKEY;
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password = generatePassword(shortcode, passkey, timestamp);
  const formattedPhone = formatPhone(phone);
  const callbackUrl = process.env.MPESA_CALLBACK_URL || 'https://daggynet.railway.app/api/mpesa/callback';

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount),
    PartyA: formattedPhone,
    PartyB: shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: callbackUrl,
    AccountReference: accountRef || 'DAGGYNET',
    TransactionDesc: `Daggynet WiFi - ${packageName}`
  };

  const response = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  return response.data;
}

// Query STK Push status
async function querySTKStatus(checkoutRequestId) {
  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE || '174379';
  const passkey = process.env.MPESA_PASSKEY;
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password = generatePassword(shortcode, passkey, timestamp);

  const response = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );

  return response.data;
}

module.exports = { initiateSTKPush, querySTKStatus, formatPhone };
