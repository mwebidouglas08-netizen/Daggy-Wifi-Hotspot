const express = require('express');
const router = express.Router();
const { User, Transaction, Package } = require('../models');

// Health check
router.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', app: 'Daggynet Hotspot', time: new Date() });
});

// Get active session by phone
router.get('/session/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\s+/g, '');
    const user = await User.findOne({ phone, status: 'active', expiresAt: { $gt: new Date() } }).populate('package');
    if (!user) return res.json({ active: false });
    const timeLeft = Math.max(0, new Date(user.expiresAt) - new Date());
    res.json({
      active: true,
      phone: user.phone,
      package: user.packageName,
      expiresAt: user.expiresAt,
      timeLeft,
      mpesaRef: user.mpesaRef
    });
  } catch (err) {
    res.json({ active: false });
  }
});

module.exports = router;
