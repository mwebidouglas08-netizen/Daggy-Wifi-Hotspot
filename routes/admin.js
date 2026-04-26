const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Admin, User, Package, Transaction, Settings, Alert } = require('../models');
const { requireAdmin } = require('../middleware/sessionManager');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts' });

// ── GET /admin (redirect to dashboard or login) ────────────────────────────
router.get('/', requireAdmin, (req, res) => res.redirect('/admin/dashboard'));

// ── GET /admin/login ─────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(__dirname, '../views/admin-login.html'));
});

// ── POST /admin/login ─────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json({ success: false, message: 'Username and password required' });
    }

    let admin = null;
    try {
      admin = await Admin.findOne({ username, isActive: true });
    } catch (e) { /* DB not ready */ }

    // Fallback to env credentials
    if (!admin) {
      const envUser = process.env.ADMIN_USERNAME || 'admin';
      const envPass = process.env.ADMIN_PASSWORD || 'Daggynet@2024';
      if (username === envUser && password === envPass) {
        req.session.adminId = 'env_admin';
        req.session.adminUsername = username;
        req.session.adminRole = 'superadmin';
        return res.json({ success: true, redirect: '/admin/dashboard' });
      }
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) return res.json({ success: false, message: 'Invalid credentials' });

    admin.lastLogin = new Date();
    await admin.save();

    req.session.adminId = admin._id.toString();
    req.session.adminUsername = admin.username;
    req.session.adminRole = admin.role;

    res.json({ success: true, redirect: '/admin/dashboard' });
  } catch (err) {
    console.error('Login error:', err);
    res.json({ success: false, message: 'Login failed. Try again.' });
  }
});

// ── GET /admin/logout ─────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ── GET /admin/dashboard ─────────────────────────────────────────────────────
router.get('/dashboard', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});

// ── API: Dashboard Stats ──────────────────────────────────────────────────────
router.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

    const [activeUsers, totalUsers, todayTx, weekTx, monthTx, totalTx, packages, alerts] = await Promise.all([
      User.countDocuments({ status: 'active' }).catch(() => 0),
      User.countDocuments().catch(() => 0),
      Transaction.aggregate([{ $match: { status: 'completed', createdAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]).catch(() => []),
      Transaction.aggregate([{ $match: { status: 'completed', createdAt: { $gte: weekStart } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]).catch(() => []),
      Transaction.aggregate([{ $match: { status: 'completed', createdAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]).catch(() => []),
      Transaction.countDocuments({ status: 'completed' }).catch(() => 0),
      Package.find({ isActive: true }).catch(() => []),
      Alert.find({ read: false }).sort({ createdAt: -1 }).limit(10).catch(() => [])
    ]);

    // Revenue by day (last 7 days)
    const revenueByDay = await Transaction.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: weekStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).catch(() => []);

    // Package breakdown
    const pkgBreakdown = await Transaction.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: monthStart } } },
      { $group: { _id: '$packageName', count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
      { $sort: { revenue: -1 } }
    ]).catch(() => []);

    res.json({
      success: true,
      stats: {
        activeUsers,
        totalUsers,
        todayRevenue: todayTx[0]?.total || 0,
        todayTransactions: todayTx[0]?.count || 0,
        weekRevenue: weekTx[0]?.total || 0,
        weekTransactions: weekTx[0]?.count || 0,
        monthRevenue: monthTx[0]?.total || 0,
        monthTransactions: monthTx[0]?.count || 0,
        totalTransactions: totalTx,
        packages: packages.length,
        revenueByDay,
        pkgBreakdown,
        alerts: alerts.length,
        alertsList: alerts
      }
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── API: Users ────────────────────────────────────────────────────────────────
router.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) query.$or = [
      { phone: { $regex: search, $options: 'i' } },
      { packageName: { $regex: search, $options: 'i' } },
      { mpesaRef: { $regex: search, $options: 'i' } }
    ];

    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip((page-1)*limit).limit(Number(limit)),
      User.countDocuments(query)
    ]);

    res.json({ success: true, users, total, pages: Math.ceil(total/limit) });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/api/users/:id/suspend', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { status: 'suspended' });
    res.json({ success: true, message: 'User suspended' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/api/users/:id/activate', requireAdmin, async (req, res) => {
  try {
    const { hours } = req.body;
    const expiresAt = new Date(Date.now() + (hours || 24) * 3600000);
    await User.findByIdAndUpdate(req.params.id, { status: 'active', expiresAt });
    res.json({ success: true, message: 'User activated' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/api/users/extend', requireAdmin, async (req, res) => {
  try {
    const { userId, hours } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });
    const base = user.expiresAt > new Date() ? user.expiresAt : new Date();
    user.expiresAt = new Date(base.getTime() + hours * 3600000);
    user.status = 'active';
    await user.save();
    res.json({ success: true, message: `Session extended by ${hours} hours` });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

// ── API: Packages ─────────────────────────────────────────────────────────────
router.get('/api/packages', requireAdmin, async (req, res) => {
  try {
    const packages = await Package.find().sort({ price: 1 });
    res.json({ success: true, packages });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/api/packages', requireAdmin, async (req, res) => {
  try {
    const pkg = await Package.create(req.body);
    res.json({ success: true, package: pkg, message: 'Package created' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.put('/api/packages/:id', requireAdmin, async (req, res) => {
  try {
    const pkg = await Package.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, package: pkg, message: 'Package updated' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.delete('/api/packages/:id', requireAdmin, async (req, res) => {
  try {
    await Package.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Package deleted' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

// ── API: Transactions ─────────────────────────────────────────────────────────
router.get('/api/transactions', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search, from, to } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) query.$or = [
      { phone: { $regex: search, $options: 'i' } },
      { mpesaRef: { $regex: search, $options: 'i' } },
      { packageName: { $regex: search, $options: 'i' } }
    ];
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) { const toDate = new Date(to); toDate.setHours(23,59,59); query.createdAt.$lte = toDate; }
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1 }).skip((page-1)*limit).limit(Number(limit)),
      Transaction.countDocuments(query)
    ]);

    const totalRevenue = await Transaction.aggregate([
      { $match: { ...query, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).catch(() => []);

    res.json({ success: true, transactions, total, pages: Math.ceil(total/limit), totalRevenue: totalRevenue[0]?.total || 0 });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

// ── API: Settings ─────────────────────────────────────────────────────────────
router.get('/api/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await Settings.find();
    const obj = {};
    settings.forEach(s => obj[s.key] = s.value);
    res.json({ success: true, settings: obj });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/api/settings', requireAdmin, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await Settings.findOneAndUpdate({ key }, { key, value, updatedAt: new Date() }, { upsert: true });
    }
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

// ── API: Admin Management ─────────────────────────────────────────────────────
router.get('/api/admins', requireAdmin, async (req, res) => {
  try {
    if (req.session.adminRole !== 'superadmin') return res.json({ success: false, message: 'Access denied' });
    const admins = await Admin.find({}, '-password');
    res.json({ success: true, admins });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/api/admins', requireAdmin, async (req, res) => {
  try {
    if (req.session.adminRole !== 'superadmin') return res.json({ success: false, message: 'Access denied' });
    const admin = await Admin.create(req.body);
    res.json({ success: true, message: 'Admin created', admin: { ...admin.toObject(), password: undefined } });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/api/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (req.session.adminId === 'env_admin') {
      if (currentPassword !== (process.env.ADMIN_PASSWORD || 'Daggynet@2024')) {
        return res.json({ success: false, message: 'Current password incorrect' });
      }
      return res.json({ success: true, message: 'Update ADMIN_PASSWORD in your .env file to persist changes' });
    }
    const admin = await Admin.findById(req.session.adminId);
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) return res.json({ success: false, message: 'Current password incorrect' });
    admin.password = newPassword;
    await admin.save();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

// ── API: Alerts ───────────────────────────────────────────────────────────────
router.post('/api/alerts/read-all', requireAdmin, async (req, res) => {
  try {
    await Alert.updateMany({ read: false }, { read: true });
    res.json({ success: true });
  } catch (err) { res.json({ success: false }); }
});

// ── API: Export CSV ───────────────────────────────────────────────────────────
router.get('/api/export/transactions', requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const query = { status: 'completed' };
    if (from) query.createdAt = { ...query.createdAt, $gte: new Date(from) };
    if (to) { const d = new Date(to); d.setHours(23,59,59); query.createdAt = { ...query.createdAt, $lte: d }; }

    const txs = await Transaction.find(query).sort({ createdAt: -1 });
    const rows = [['Date', 'Phone', 'Package', 'Amount', 'M-Pesa Ref', 'Status']];
    txs.forEach(t => rows.push([
      new Date(t.createdAt).toLocaleString('en-KE'),
      t.phone, t.packageName, t.amount, t.mpesaRef || '', t.status
    ]));
    const csv = rows.map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
    res.send(csv);
  } catch (err) { res.json({ success: false, message: err.message }); }
});

// ── API: Session info ─────────────────────────────────────────────────────────
router.get('/api/session-info', requireAdmin, (req, res) => {
  res.json({ success: true, username: req.session.adminUsername, role: req.session.adminRole });
});

module.exports = router;
