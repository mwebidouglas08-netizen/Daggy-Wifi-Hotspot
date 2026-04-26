# 📡 Daggynet Hotspot — Full Captive Portal System

A complete WiFi hotspot management system with M-Pesa STK Push payments, customer captive portal, and admin dashboard.

---

## 🚀 Features

### Customer Portal (`/`)
- Beautiful captive portal shown when users connect to WiFi
- Package selection with pricing cards
- M-Pesa STK Push payment (phone prompt)
- Auto-polling for payment confirmation
- Reconnect tab — reconnect by phone or M-Pesa reference
- Manual M-Pesa reference verification (for errors)
- Auto-detect valid transaction reference
- Support tab — call, WhatsApp, email, SMS
- FAQ and troubleshooting guide
- Fully mobile responsive

### Admin Dashboard (`/admin`)
- Secure login with rate limiting
- Dashboard with live stats and revenue charts
- Users & Sessions management (kick, suspend, extend, delete)
- Package management (create, edit, enable/disable, delete)
- Transaction history with CSV export and date filtering
- System settings (business info, portal customization)
- Admin account management (multi-admin support)
- Real-time alerts for new payments

---

## 📋 Prerequisites

- Node.js >= 18
- MongoDB database (MongoDB Atlas free tier works)
- Safaricom M-Pesa Daraja API account (sandbox for testing)
- Railway account (for deployment)

---

## ⚙️ Local Setup

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/daggynet-hotspot.git
cd daggynet-hotspot
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=your_random_secret_here

# MongoDB (get free cluster at mongodb.com/atlas)
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/daggynet

# M-Pesa Daraja API (register at developer.safaricom.co.ke)
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_PASSKEY=your_lipa_na_mpesa_passkey
MPESA_SHORTCODE=174379
MPESA_CALLBACK_URL=https://your-app.railway.app/api/mpesa/callback
MPESA_ENVIRONMENT=sandbox

# Admin Login
ADMIN_USERNAME=admin
ADMIN_PASSWORD=Daggynet@2024
ADMIN_EMAIL=daggytechs@gmail.com
```

### 3. Run Locally
```bash
npm run dev
```

- Portal: http://localhost:3000
- Admin: http://localhost:3000/admin
- Login: admin / Daggynet@2024

> **Note:** If M-Pesa is not configured, the app runs in **Demo Mode** — payments are simulated automatically so you can test the full flow.

---

## 🚂 Deploy to Railway (Step-by-Step)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit — Daggynet Hotspot"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/daggynet-hotspot.git
git push -u origin main
```

### Step 2: Create Railway Project
1. Go to [railway.app](https://railway.app) and sign up/login
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `daggynet-hotspot` repository
4. Railway will auto-detect Node.js and start building

### Step 3: Add MongoDB Database
1. In your Railway project, click **"+ New"** → **"Database"** → **"MongoDB"**
2. After it provisions, click on it and copy the **connection string**
3. It will look like: `mongodb://mongo:password@host:port/`

### Step 4: Set Environment Variables
In Railway project → **Variables** tab, add:

| Variable | Value |
|---|---|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | `any_long_random_string_here` |
| `MONGODB_URI` | `your_mongodb_connection_string` |
| `MPESA_CONSUMER_KEY` | `from Daraja portal` |
| `MPESA_CONSUMER_SECRET` | `from Daraja portal` |
| `MPESA_PASSKEY` | `from Daraja portal` |
| `MPESA_SHORTCODE` | `your paybill/till number` |
| `MPESA_ENVIRONMENT` | `sandbox` (then `production` when ready) |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | `YourSecurePassword123!` |
| `ADMIN_EMAIL` | `daggytechs@gmail.com` |

### Step 5: Set Callback URL
After Railway gives you a domain (e.g. `daggynet.up.railway.app`):
1. Copy the full URL
2. Set: `MPESA_CALLBACK_URL` = `https://daggynet.up.railway.app/api/mpesa/callback`
3. Also update this in your Daraja portal app settings

### Step 6: Go Live!
Railway auto-deploys on every push to `main`. Your app will be live at the Railway-provided URL.

---

## 📱 M-Pesa Daraja API Setup

### Register for Daraja API
1. Go to [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create an account and verify your email
3. Click **"Create App"**
4. Enable **"Lipa Na M-Pesa Online"** (STK Push)
5. Copy your **Consumer Key** and **Consumer Secret**

### Get Your Passkey
1. In Daraja portal → **Lipa Na M-Pesa Online**
2. Under **Sandbox** section → click **"Initiate STK Push"**
3. Note the **Passkey** shown there (long string)

### Test in Sandbox
Use these test credentials in sandbox:
- **Shortcode:** `174379`
- **Test Phone:** `254708374149` (always succeeds)
- **Test PIN:** `12345`

### Go to Production
1. Apply for **"Go Live"** on Daraja portal
2. You'll need: Business Registration Certificate, M-Pesa Paybill/Till
3. Change `MPESA_ENVIRONMENT=production` in Railway
4. Update shortcode to your real Paybill/Till number

---

## 🛜 Router Integration (MikroTik)

To use as a real captive portal on MikroTik:

### Option A: DNS Redirect (Simple)
1. In MikroTik Winbox → **IP** → **Hotspot** → **Server Profiles**
2. Set **Login URL** to `https://your-app.railway.app/`
3. MikroTik will redirect all HTTP traffic to your portal

### Option B: Full Hotspot (Advanced)
```
/ip hotspot
add address-pool=hs-pool-1 disabled=no interface=wlan1 name=hotspot1 profile=hsprof1

/ip hotspot profile
set [find default=yes] login-by=mac,http-pap dns-name=daggynet.local

/ip hotspot user profile
add name=daily rate-limit=10M/5M session-timeout=1d
add name=weekly rate-limit=15M/8M session-timeout=7d
add name=monthly rate-limit=20M/10M
```

### RADIUS Integration
For automated user management, set up FreeRADIUS pointing to your Railway app's `/api` endpoint.

---

## 💰 MikroTik + This System Integration

When a user pays and gets activated in your system, you can use the MikroTik API to programmatically add them:

```javascript
// Example: add to MikroTik via RouterOS API after payment
const Mikrotik = require('node-routeros');
const api = new Mikrotik({ host: MIKROTIK_HOST, user: MIKROTIK_USER, password: MIKROTIK_PASSWORD });
api.write('/ip/hotspot/user/add', [`=name=${phone}`, `=password=${mpesaRef}`, `=profile=${pkgName}`]);
```

---

## 📁 Project Structure

```
daggynet-hotspot/
├── server.js              # Main Express app
├── package.json
├── .env.example
├── railway.toml           # Railway deployment config
├── Procfile
├── config/
│   ├── database.js        # MongoDB connection
│   └── mpesa.js           # M-Pesa Daraja API
├── models/
│   └── index.js           # User, Package, Transaction, Admin models
├── middleware/
│   └── sessionManager.js  # Auth, session management, DB seeding
├── routes/
│   ├── portal.js          # Customer portal routes
│   ├── mpesa.js           # STK Push, callback, manual verify
│   ├── admin.js           # Admin dashboard API
│   └── api.js             # General API routes
├── views/
│   ├── portal.html        # Customer captive portal
│   ├── admin-login.html   # Admin login page
│   └── admin.html         # Admin dashboard
└── public/
    └── 404.html
```

---

## 🔒 Security Notes

1. **Change default admin password** immediately after first login
2. **Use a strong SESSION_SECRET** (32+ random characters)
3. **Never commit .env** to GitHub (it's in .gitignore)
4. **Enable HTTPS** — Railway provides this automatically
5. **Rate limiting** is enabled on the login endpoint (10 attempts per 15 min)

---

## 🆘 Support

- 📞 Phone: 0796820013
- ✉️ Email: daggytechs@gmail.com
- 💬 WhatsApp: https://wa.me/254796820013

---

## 📜 License

MIT License — Free to use and modify for your business.
