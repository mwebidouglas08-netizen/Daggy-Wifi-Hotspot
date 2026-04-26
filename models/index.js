const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── PACKAGE MODEL ─────────────────────────────────────────────────────────────
const packageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  displayName: { type: String, required: true },
  price: { type: Number, required: true },
  duration: { type: Number, required: true }, // in minutes
  durationLabel: { type: String, required: true }, // e.g. "1 Hour", "1 Day"
  downloadSpeed: { type: Number, default: 10 }, // Mbps
  uploadSpeed: { type: Number, default: 5 }, // Mbps
  dataLimit: { type: Number, default: 0 }, // MB, 0=unlimited
  description: { type: String },
  isActive: { type: Boolean, default: true },
  popular: { type: Boolean, default: false },
  icon: { type: String, default: '⚡' },
  color: { type: String, default: '#3b82f6' },
  totalSales: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// ─── USER/SESSION MODEL ────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  macAddress: { type: String },
  ipAddress: { type: String },
  package: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  packageName: { type: String },
  packagePrice: { type: Number },
  status: {
    type: String,
    enum: ['active', 'expired', 'suspended', 'pending'],
    default: 'pending'
  },
  connectedAt: { type: Date },
  expiresAt: { type: Date },
  dataUsed: { type: Number, default: 0 }, // MB
  lastSeen: { type: Date, default: Date.now },
  mpesaRef: { type: String },
  transactionId: { type: String },
  deviceInfo: { type: String },
  totalSessions: { type: Number, default: 1 },
  totalSpent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// ─── TRANSACTION MODEL ─────────────────────────────────────────────────────────
const transactionSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  amount: { type: Number, required: true },
  mpesaRef: { type: String, unique: true, sparse: true },
  checkoutRequestId: { type: String },
  merchantRequestId: { type: String },
  package: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  packageName: { type: String },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  macAddress: { type: String },
  ipAddress: { type: String },
  rawCallback: { type: mongoose.Schema.Types.Mixed },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
});

// ─── ADMIN MODEL ───────────────────────────────────────────────────────────────
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  role: { type: String, enum: ['superadmin', 'admin', 'viewer'], default: 'admin' },
  lastLogin: { type: Date },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

adminSchema.methods.comparePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// ─── SETTINGS MODEL ────────────────────────────────────────────────────────────
const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
});

// ─── ALERT MODEL ───────────────────────────────────────────────────────────────
const alertSchema = new mongoose.Schema({
  type: { type: String, enum: ['info', 'warning', 'error', 'success'] },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Package = mongoose.model('Package', packageSchema);
const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Alert = mongoose.model('Alert', alertSchema);

module.exports = { Package, User, Transaction, Admin, Settings, Alert };
