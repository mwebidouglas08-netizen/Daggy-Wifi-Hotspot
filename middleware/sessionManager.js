const { User, Package, Admin, Settings } = require('../models');
const moment = require('moment');

// Expire users whose session has ended
async function expireUsers() {
  try {
    const result = await User.updateMany(
      { status: 'active', expiresAt: { $lt: new Date() } },
      { status: 'expired' }
    );
    if (result.modifiedCount > 0) {
      console.log(`⏰ Expired ${result.modifiedCount} user session(s)`);
    }
  } catch (err) {
    // Silent fail - DB might not be connected
  }
}

// Middleware: check if admin is authenticated
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  req.flash('error', 'Please login to access admin panel');
  return res.redirect('/admin/login');
}

// Middleware: check if user has active session by MAC/IP
async function checkUserSession(req, res, next) {
  req.activeUser = null;
  try {
    const mac = req.query.mac || req.headers['x-mac-address'];
    const ip = req.ip || req.connection.remoteAddress;
    if (mac) {
      const user = await User.findOne({
        macAddress: mac,
        status: 'active',
        expiresAt: { $gt: new Date() }
      }).populate('package');
      req.activeUser = user;
    }
  } catch (err) { /* silent */ }
  next();
}

// Seed initial data if DB is empty
async function seedDatabase() {
  try {
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const admin = new Admin({
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || 'Daggynet@2024',
        email: process.env.ADMIN_EMAIL || 'daggytechs@gmail.com',
        role: 'superadmin'
      });
      await admin.save();
      console.log('✅ Admin account created');
    }

    const pkgCount = await Package.countDocuments();
    if (pkgCount === 0) {
      const packages = [
        { name: '1hr', displayName: '1 Hour', price: 10, duration: 60, durationLabel: '1 Hour', downloadSpeed: 5, uploadSpeed: 2, dataLimit: 500, icon: '⚡', color: '#f59e0b', description: 'Quick browse session' },
        { name: 'daily', displayName: 'Daily', price: 50, duration: 1440, durationLabel: '24 Hours', downloadSpeed: 10, uploadSpeed: 5, dataLimit: 2048, icon: '🌅', color: '#3b82f6', description: 'Full day access', popular: true },
        { name: 'weekly', displayName: 'Weekly', price: 200, duration: 10080, durationLabel: '7 Days', downloadSpeed: 15, uploadSpeed: 8, dataLimit: 15360, icon: '📅', color: '#8b5cf6', description: 'Best value for week' },
        { name: 'monthly', displayName: 'Monthly', price: 500, duration: 43200, durationLabel: '30 Days', downloadSpeed: 20, uploadSpeed: 10, dataLimit: 0, icon: '🗓️', color: '#10b981', description: 'Unlimited monthly plan' },
        { name: '30min', displayName: '30 Minutes', price: 5, duration: 30, durationLabel: '30 Min', downloadSpeed: 3, uploadSpeed: 1, dataLimit: 200, icon: '⏱️', color: '#ef4444', description: 'Short quick session' },
      ];
      await Package.insertMany(packages);
      console.log('✅ Default packages created');
    }

    const settingsCount = await Settings.countDocuments();
    if (settingsCount === 0) {
      const defaultSettings = [
        { key: 'business_name', value: 'Daggynet Hotspot' },
        { key: 'support_phone', value: '0796820013' },
        { key: 'support_email', value: 'daggytechs@gmail.com' },
        { key: 'mpesa_paybill', value: '174379' },
        { key: 'hotspot_ssid', value: 'Daggynet_WiFi' },
        { key: 'max_devices', value: 100 },
        { key: 'portal_welcome', value: 'Welcome to Daggynet Hotspot' },
        { key: 'portal_subtitle', value: 'Fast & Reliable Internet Access' },
        { key: 'maintenance_mode', value: false },
        { key: 'free_minutes', value: 0 }
      ];
      await Settings.insertMany(defaultSettings);
      console.log('✅ Default settings created');
    }
  } catch (err) {
    console.log('⚠️  Seeding skipped (DB not ready):', err.message);
  }
}

// Get setting value
async function getSetting(key, defaultValue = null) {
  try {
    const setting = await Settings.findOne({ key });
    return setting ? setting.value : defaultValue;
  } catch (err) {
    return defaultValue;
  }
}

module.exports = { expireUsers, requireAdmin, checkUserSession, seedDatabase, getSetting };
