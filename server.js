require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const cron = require('node-cron');

const connectDB = require('./config/database');
const { expireUsers } = require('./middleware/sessionManager');

// Route imports
const portalRoutes = require('./routes/portal');
const mpesaRoutes = require('./routes/mpesa');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect Database
connectDB();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(cors());
app.use(morgan('combined'));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'daggynet_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(flash());

// View engine
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

// Custom render for HTML files
app.engine('html', (filePath, options, callback) => {
  const fs = require('fs');
  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) return callback(err);
    // Simple template variable replacement
    let rendered = content;
    Object.keys(options).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(regex, options[key] || '');
    });
    return callback(null, rendered);
  });
});

// Global middleware
app.use((req, res, next) => {
  res.locals.flash_success = req.flash('success');
  res.locals.flash_error = req.flash('error');
  next();
});

// Routes
app.use('/', portalRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Cron job: expire users every minute
cron.schedule('* * * * *', async () => {
  try {
    await expireUsers();
  } catch (err) {
    console.error('Cron error:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Daggynet Hotspot running on port ${PORT}`);
  console.log(`🌐 Portal: http://localhost:${PORT}`);
  console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
});

module.exports = app;
