const express = require('express');
const router = express.Router();
const { initiateSTKPush, querySTKStatus } = require('../config/mpesa');
const { Package, User, Transaction, Alert } = require('../models');

// ── POST /api/mpesa/pay ───────────────────────────────────────────────────────
router.post('/pay', async (req, res) => {
  try {
    const { phone, packageId, mac, ip } = req.body;

    if (!phone || !packageId) {
      return res.json({ success: false, message: 'Phone number and package are required' });
    }

    // Validate phone
    const phoneClean = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (phoneClean.length < 9) {
      return res.json({ success: false, message: 'Invalid phone number' });
    }

    // Get package
    let pkg;
    try {
      pkg = await Package.findById(packageId);
    } catch (e) { /* not a valid ObjectId, use mock */ }

    if (!pkg) {
      // Create a temporary package object for demo/fallback
      const defaultPkgs = {
        '30min': { _id: packageId, displayName: '30 Minutes', price: 5, duration: 30, name: '30min' },
        '1hr': { _id: packageId, displayName: '1 Hour', price: 10, duration: 60, name: '1hr' },
        'daily': { _id: packageId, displayName: 'Daily', price: 50, duration: 1440, name: 'daily' },
        'weekly': { _id: packageId, displayName: 'Weekly', price: 200, duration: 10080, name: 'weekly' },
        'monthly': { _id: packageId, displayName: 'Monthly', price: 500, duration: 43200, name: 'monthly' },
      };
      pkg = defaultPkgs[packageId];
      if (!pkg) return res.json({ success: false, message: 'Package not found' });
    }

    // Create pending transaction
    let transaction;
    try {
      transaction = await Transaction.create({
        phone: phoneClean,
        amount: pkg.price,
        package: pkg._id && pkg._id.toString().length === 24 ? pkg._id : undefined,
        packageName: pkg.displayName,
        status: 'pending',
        macAddress: mac || '',
        ipAddress: ip || req.ip
      });
    } catch (e) {
      transaction = { _id: 'temp_' + Date.now(), phone: phoneClean, amount: pkg.price };
    }

    // Initiate STK push
    try {
      const stkResponse = await initiateSTKPush({
        phone: phoneClean,
        amount: pkg.price,
        packageName: pkg.displayName,
        accountRef: 'DAGGYNET'
      });

      if (stkResponse.ResponseCode === '0') {
        // Update transaction with checkout ID
        if (transaction._id && !transaction._id.toString().startsWith('temp_')) {
          await Transaction.findByIdAndUpdate(transaction._id, {
            checkoutRequestId: stkResponse.CheckoutRequestID,
            merchantRequestId: stkResponse.MerchantRequestID
          });
        }

        return res.json({
          success: true,
          message: 'STK push sent! Check your phone and enter M-Pesa PIN.',
          checkoutRequestId: stkResponse.CheckoutRequestID,
          transactionId: transaction._id.toString(),
          phone: phoneClean,
          amount: pkg.price,
          package: pkg.displayName
        });
      } else {
        return res.json({ success: false, message: stkResponse.ResponseDescription || 'STK push failed' });
      }
    } catch (mpesaErr) {
      console.error('M-Pesa error:', mpesaErr.message);

      // DEMO MODE: simulate successful payment if M-Pesa not configured
      if (!process.env.MPESA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY === 'your_consumer_key_here') {
        const fakeCheckoutId = 'ws_CO_' + Date.now();
        return res.json({
          success: true,
          message: '📱 [DEMO] STK push simulated. Click "I have paid" to continue.',
          checkoutRequestId: fakeCheckoutId,
          transactionId: transaction._id.toString(),
          phone: phoneClean,
          amount: pkg.price,
          package: pkg.displayName,
          demo: true
        });
      }

      return res.json({ success: false, message: 'Payment service unavailable. Try again or contact support.' });
    }
  } catch (err) {
    console.error('Pay route error:', err);
    res.json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── POST /api/mpesa/query ─────────────────────────────────────────────────────
router.post('/query', async (req, res) => {
  try {
    const { checkoutRequestId, transactionId, packageId, phone, mac } = req.body;

    // Check if already completed in our DB
    if (transactionId && !transactionId.startsWith('temp_')) {
      try {
        const tx = await Transaction.findById(transactionId);
        if (tx && tx.status === 'completed') {
          return res.json({ success: true, status: 'completed', mpesaRef: tx.mpesaRef });
        }
      } catch (e) { /* continue */ }
    }

    // DEMO MODE: auto-complete if no M-Pesa configured
    if (!process.env.MPESA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY === 'your_consumer_key_here') {
      const demoRef = 'DEMO' + Math.random().toString(36).toUpperCase().slice(2, 9);
      await activateUser({ phone, packageId, mpesaRef: demoRef, mac, ip: req.ip, transactionId });
      return res.json({ success: true, status: 'completed', mpesaRef: demoRef, demo: true });
    }

    // Real query
    try {
      const queryResult = await querySTKStatus(checkoutRequestId);
      if (queryResult.ResultCode === '0' || queryResult.ResultCode === 0) {
        return res.json({ success: true, status: 'completed' });
      } else if (queryResult.ResultCode === '1032') {
        return res.json({ success: false, status: 'cancelled', message: 'Payment cancelled by user' });
      } else {
        return res.json({ success: false, status: 'pending', message: queryResult.ResultDesc || 'Payment pending' });
      }
    } catch (e) {
      return res.json({ success: false, status: 'pending', message: 'Checking payment status...' });
    }
  } catch (err) {
    res.json({ success: false, message: 'Query failed' });
  }
});

// ── POST /api/mpesa/callback ──────────────────────────────────────────────────
router.post('/callback', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const body = req.body;
    const stkCallback = body?.Body?.stkCallback;
    if (!stkCallback) return;

    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = stkCallback;

    const tx = await Transaction.findOne({ checkoutRequestId: CheckoutRequestID });
    if (!tx) return console.log('Transaction not found for:', CheckoutRequestID);

    if (ResultCode === 0) {
      // Extract M-Pesa details
      const items = CallbackMetadata?.Item || [];
      const getItem = (name) => items.find(i => i.Name === name)?.Value;

      const mpesaRef = getItem('MpesaReceiptNumber');
      const amount = getItem('Amount');
      const phone = getItem('PhoneNumber');

      tx.status = 'completed';
      tx.mpesaRef = mpesaRef;
      tx.completedAt = new Date();
      tx.rawCallback = body;
      await tx.save();

      // Activate user
      await activateUser({
        phone: tx.phone,
        packageId: tx.package,
        mpesaRef,
        mac: tx.macAddress,
        ip: tx.ipAddress,
        transactionId: tx._id.toString()
      });

      // Create alert
      try {
        await Alert.create({
          type: 'success',
          message: `New payment: ${tx.phone} paid KSh ${amount} for ${tx.packageName} (${mpesaRef})`
        });
      } catch (e) { /* silent */ }

    } else {
      tx.status = 'failed';
      tx.errorMessage = ResultDesc;
      tx.rawCallback = body;
      await tx.save();
    }
  } catch (err) {
    console.error('Callback error:', err);
  }
});

// ── POST /api/mpesa/manual-verify ─────────────────────────────────────────────
router.post('/manual-verify', async (req, res) => {
  try {
    const { mpesaRef, phone, mac } = req.body;
    if (!mpesaRef) return res.json({ success: false, message: 'M-Pesa reference required' });

    const refClean = mpesaRef.trim().toUpperCase();
    const tx = await Transaction.findOne({ mpesaRef: refClean });

    if (!tx) {
      return res.json({ success: false, message: 'Transaction not found. Verify the M-Pesa reference code and try again.' });
    }
    if (tx.status !== 'completed') {
      return res.json({ success: false, message: 'Transaction is not completed. Status: ' + tx.status });
    }

    // Check if already has active session
    const existing = await User.findOne({ mpesaRef: refClean, status: 'active', expiresAt: { $gt: new Date() } });
    if (existing) {
      const timeLeft = Math.max(0, new Date(existing.expiresAt) - new Date());
      const h = Math.floor(timeLeft / 3600000);
      const m = Math.floor((timeLeft % 3600000) / 60000);
      return res.json({ success: true, message: `Already connected! Time left: ${h}h ${m}m`, alreadyActive: true });
    }

    // Activate
    await activateUser({ phone: tx.phone, packageId: tx.package, mpesaRef: refClean, mac: mac || tx.macAddress, ip: req.ip, transactionId: tx._id.toString() });

    return res.json({ success: true, message: `Access granted! Welcome back. Reference: ${refClean}`, mpesaRef: refClean });
  } catch (err) {
    console.error('Manual verify error:', err);
    res.json({ success: false, message: 'Verification failed. Contact support.' });
  }
});

// ── Helper: Activate User ─────────────────────────────────────────────────────
async function activateUser({ phone, packageId, mpesaRef, mac, ip, transactionId }) {
  try {
    let pkg = null;
    try { pkg = await Package.findById(packageId); } catch (e) { /* not ObjectId */ }

    if (!pkg) {
      const defaults = { '30min': 30, '1hr': 60, 'daily': 1440, 'weekly': 10080, 'monthly': 43200 };
      const labels = { '30min': '30 Minutes', '1hr': '1 Hour', 'daily': 'Daily', 'weekly': 'Weekly', 'monthly': 'Monthly' };
      const dur = defaults[packageId] || 1440;
      pkg = { _id: packageId, displayName: labels[packageId] || 'Daily', price: 50, duration: dur };
    }

    const expiresAt = new Date(Date.now() + pkg.duration * 60 * 1000);

    // Deactivate old sessions for same phone
    await User.updateMany({ phone, status: 'active' }, { status: 'expired' }).catch(() => {});

    const user = await User.create({
      phone,
      package: pkg._id && pkg._id.toString && pkg._id.toString().length === 24 ? pkg._id : undefined,
      packageName: pkg.displayName,
      packagePrice: pkg.price,
      status: 'active',
      connectedAt: new Date(),
      expiresAt,
      mpesaRef: mpesaRef || '',
      transactionId: transactionId || '',
      macAddress: mac || '',
      ipAddress: ip || ''
    });

    // Update package sales stats
    try {
      await Package.findByIdAndUpdate(pkg._id, { $inc: { totalSales: 1, totalRevenue: pkg.price } });
    } catch (e) { /* silent */ }

    // Update transaction with userId
    if (transactionId && !transactionId.startsWith('temp_')) {
      try { await Transaction.findByIdAndUpdate(transactionId, { userId: user._id }); } catch (e) { /* silent */ }
    }

    return user;
  } catch (err) {
    console.error('Activate user error:', err);
  }
}

module.exports = router;
module.exports.activateUser = activateUser;
