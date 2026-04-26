const express = require('express');
const router = express.Router();
const path = require('path');
const { Package, User, Transaction } = require('../models');
const { getSetting, seedDatabase } = require('../middleware/sessionManager');

// Seed DB on first load
let seeded = false;
router.use(async (req, res, next) => {
  if (!seeded) { await seedDatabase(); seeded = true; }
  next();
});

// ── GET / (Captive Portal Home) ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true }).sort({ price: 1 });
    const mac = req.query.mac || req.query.macAddress || '';
    const ip = req.query.ip || req.ip || '';
    const businessName = await getSetting('business_name', 'Daggynet Hotspot');
    const welcomeMsg = await getSetting('portal_welcome', 'Welcome to Daggynet Hotspot');
    const subtitle = await getSetting('portal_subtitle', 'Fast & Reliable Internet Access');
    const mpesaPaybill = await getSetting('mpesa_paybill', '174379');
    const supportPhone = await getSetting('support_phone', '0796820013');
    const maintenance = await getSetting('maintenance_mode', false);

    res.sendFile(path.join(__dirname, '../views/portal.html'));
  } catch (err) {
    res.sendFile(path.join(__dirname, '../views/portal.html'));
  }
});

// ── GET /api/portal-data ─────────────────────────────────────────────────────
router.get('/api/portal-data', async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true }).sort({ price: 1 });
    const businessName = await getSetting('business_name', 'Daggynet Hotspot');
    const welcomeMsg = await getSetting('portal_welcome', 'Welcome to Daggynet Hotspot');
    const subtitle = await getSetting('portal_subtitle', 'Fast & Reliable Internet Access');
    const mpesaPaybill = await getSetting('mpesa_paybill', '174379');
    const supportPhone = await getSetting('support_phone', '0796820013');
    const supportEmail = await getSetting('support_email', 'daggytechs@gmail.com');
    const maintenance = await getSetting('maintenance_mode', false);

    res.json({
      success: true,
      packages: packages.map(p => ({
        _id: p._id,
        name: p.name,
        displayName: p.displayName,
        price: p.price,
        durationLabel: p.durationLabel,
        downloadSpeed: p.downloadSpeed,
        uploadSpeed: p.uploadSpeed,
        dataLimit: p.dataLimit,
        description: p.description,
        popular: p.popular,
        icon: p.icon,
        color: p.color
      })),
      settings: { businessName, welcomeMsg, subtitle, mpesaPaybill, supportPhone, supportEmail, maintenance }
    });
  } catch (err) {
    res.json({
      success: true,
      packages: getDefaultPackages(),
      settings: { businessName: 'Daggynet Hotspot', supportPhone: '0796820013', supportEmail: 'daggytechs@gmail.com' }
    });
  }
});

// ── GET /success ────────────────────────────────────────────────────────────
router.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/success.html'));
});

// ── GET /check-session ───────────────────────────────────────────────────────
router.get('/check-session', async (req, res) => {
  try {
    const { mac, phone } = req.query;
    let user = null;

    if (mac) {
      user = await User.findOne({ macAddress: mac, status: 'active', expiresAt: { $gt: new Date() } }).populate('package');
    } else if (phone) {
      const cleanPhone = phone.replace(/\s+/g, '');
      user = await User.findOne({ phone: cleanPhone, status: 'active', expiresAt: { $gt: new Date() } }).populate('package');
    }

    if (user) {
      const timeLeft = Math.max(0, new Date(user.expiresAt) - new Date());
      const hoursLeft = Math.floor(timeLeft / 3600000);
      const minutesLeft = Math.floor((timeLeft % 3600000) / 60000);
      res.json({
        active: true,
        phone: user.phone,
        package: user.packageName,
        expiresAt: user.expiresAt,
        timeLeft: `${hoursLeft}h ${minutesLeft}m`,
        mpesaRef: user.mpesaRef
      });
    } else {
      res.json({ active: false });
    }
  } catch (err) {
    res.json({ active: false });
  }
});

// ── GET /verify-transaction ──────────────────────────────────────────────────
router.get('/verify-transaction', async (req, res) => {
  try {
    const { ref, phone } = req.query;
    if (!ref) return res.json({ success: false, message: 'No reference provided' });

    const tx = await Transaction.findOne({
      mpesaRef: ref.toUpperCase(),
      status: 'completed'
    }).populate('package');

    if (!tx) {
      return res.json({ success: false, message: 'Transaction not found or not completed' });
    }

    // Check if user already created for this tx
    let user = await User.findOne({ mpesaRef: ref.toUpperCase() });
    if (!user && tx.userId) {
      user = await User.findById(tx.userId);
    }

    if (user && user.status === 'active') {
      const timeLeft = Math.max(0, new Date(user.expiresAt) - new Date());
      const hoursLeft = Math.floor(timeLeft / 3600000);
      const minutesLeft = Math.floor((timeLeft % 3600000) / 60000);
      return res.json({
        success: true,
        message: 'Transaction verified! Connecting you...',
        package: tx.packageName,
        phone: tx.phone,
        timeLeft: `${hoursLeft}h ${minutesLeft}m`
      });
    }

    // Create user session from verified transaction
    if (tx.status === 'completed') {
      const pkg = tx.package || await Package.findById(tx.package);
      if (pkg) {
        const expiresAt = new Date(Date.now() + pkg.duration * 60 * 1000);
        const newUser = await User.create({
          phone: tx.phone,
          package: pkg._id,
          packageName: pkg.displayName,
          packagePrice: tx.amount,
          status: 'active',
          connectedAt: new Date(),
          expiresAt,
          mpesaRef: tx.mpesaRef,
          transactionId: tx._id.toString(),
          macAddress: req.query.mac || ''
        });
        tx.userId = newUser._id;
        await tx.save();
        return res.json({
          success: true,
          message: 'Access granted! Enjoy your internet.',
          package: pkg.displayName,
          phone: tx.phone,
          expiresAt
        });
      }
    }

    res.json({ success: false, message: 'Could not activate session. Contact support.' });
  } catch (err) {
    console.error('Verify error:', err);
    res.json({ success: false, message: 'Verification error. Try again.' });
  }
});

function getDefaultPackages() {
  return [
    { _id: '1', name: '30min', displayName: '30 Minutes', price: 5, durationLabel: '30 Min', downloadSpeed: 3, uploadSpeed: 1, icon: '⏱️', color: '#ef4444', description: 'Quick session' },
    { _id: '2', name: '1hr', displayName: '1 Hour', price: 10, durationLabel: '1 Hour', downloadSpeed: 5, uploadSpeed: 2, icon: '⚡', color: '#f59e0b', description: 'Short browse' },
    { _id: '3', name: 'daily', displayName: 'Daily', price: 50, durationLabel: '24 Hours', downloadSpeed: 10, uploadSpeed: 5, icon: '🌅', color: '#3b82f6', description: 'Full day access', popular: true },
    { _id: '4', name: 'weekly', displayName: 'Weekly', price: 200, durationLabel: '7 Days', downloadSpeed: 15, uploadSpeed: 8, icon: '📅', color: '#8b5cf6', description: 'Best value' },
    { _id: '5', name: 'monthly', displayName: 'Monthly', price: 500, durationLabel: '30 Days', downloadSpeed: 20, uploadSpeed: 10, icon: '🗓️', color: '#10b981', description: 'Unlimited plan' },
  ];
}

module.exports = router;
