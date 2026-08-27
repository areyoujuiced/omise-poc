require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const merchantStore = require('./merchantStore');

const app = express();
app.set('trust proxy', 1); // needed for secure cookies behind Render's proxy
app.use(express.json({ limit: '3mb' })); // registered-merchant logos arrive as base64 data URIs
app.use(session({
  secret: process.env.SESSION_SECRET || 'omise-poc-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

function omiseAuthHeader(secretKey) {
  return 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
}

function requireAuth(req, res, next) {
  if (!req.session.merchant) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// The branding + capability fields the frontend needs, stripped of keys.
// enabledMethods is undefined (omitted from JSON) for merchants without a
// restriction, which the frontend treats as "everything's available."
function merchantPublicShape(merchant) {
  return {
    username: merchant.username,
    displayName: merchant.displayName,
    logo: merchant.logo,
    enabledMethods: merchant.enabledMethods,
  };
}

// Self-service registration. Omise keys are required up front but are
// never handed to merchantStore — they go straight onto this session and
// nowhere else (see merchantStore.js for why).
app.post('/api/register', async (req, res) => {
  const { username, password, displayName, logo, publicKey, secretKey } = req.body;
  if (!publicKey || !secretKey) {
    return res.status(400).json({ error: 'Omise public and secret keys are required.' });
  }
  const result = await merchantStore.register(username, password, displayName, logo);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  req.session.merchant = {
    username: result.merchant.username,
    displayName: result.merchant.displayName,
    logo: result.merchant.logo,
    enabledMethods: result.merchant.enabledMethods,
    publicKey,
    secretKey,
  };
  res.json(merchantPublicShape(req.session.merchant));
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const merchant = await merchantStore.verifyPassword(username, password);
  if (!merchant) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (merchant.publicKey) {
    // Pilot merchant — keys already resolved from env vars, login completes now.
    req.session.merchant = merchant;
    return res.json(merchantPublicShape(merchant));
  }
  // Self-registered merchant — keys were never stored, so login isn't
  // complete until they're re-entered.
  req.session.pendingMerchant = {
    username: merchant.username,
    displayName: merchant.displayName,
    logo: merchant.logo,
    enabledMethods: merchant.enabledMethods,
  };
  res.json({ ...merchantPublicShape(merchant), needsKeys: true });
});

// Second step of login for self-registered merchants only — attaches the
// freshly-entered keys to the session that /api/login left pending.
app.post('/api/login-keys', (req, res) => {
  const { publicKey, secretKey } = req.body;
  if (!req.session.pendingMerchant) {
    return res.status(401).json({ error: 'No login in progress.' });
  }
  if (!publicKey || !secretKey) {
    return res.status(400).json({ error: 'Omise public and secret keys are required.' });
  }
  req.session.merchant = { ...req.session.pendingMerchant, publicKey, secretKey };
  delete req.session.pendingMerchant;
  res.json(merchantPublicShape(req.session.merchant));
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({
    loggedIn: !!req.session.merchant,
    ...(req.session.merchant ? merchantPublicShape(req.session.merchant) : {
      username: null,
      displayName: null,
      logo: null,
    }),
  });
});

// Frontend needs the logged-in merchant's public key to initialize Omise.js
// — never expose the secret key.
app.get('/api/config', requireAuth, (req, res) => {
  res.json({ publicKey: req.session.merchant.publicKey });
});

// Charge a tokenized card (token created client-side via Omise.js)
app.post('/api/charge-card', requireAuth, async (req, res) => {
  const { token, amount } = req.body;
  if (!token || !amount) {
    return res.status(400).json({ error: 'token and amount are required' });
  }
  try {
    const params = new URLSearchParams({
      amount: String(amount),
      currency: 'thb',
      card: token,
    });
    const response = await fetch('https://api.omise.co/charges', {
      method: 'POST',
      headers: {
        Authorization: omiseAuthHeader(req.session.merchant.secretKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a PromptPay QR charge
app.post('/api/charge-qr', requireAuth, async (req, res) => {
  const { amount } = req.body;
  if (!amount) {
    return res.status(400).json({ error: 'amount is required' });
  }
  try {
    const params = new URLSearchParams({
      amount: String(amount),
      currency: 'thb',
      'source[type]': 'promptpay',
    });
    const response = await fetch('https://api.omise.co/charges', {
      method: 'POST',
      headers: {
        Authorization: omiseAuthHeader(req.session.merchant.secretKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a TrueMoney Wallet charge
app.post('/api/charge-truemoney', requireAuth, async (req, res) => {
  const { amount, phone } = req.body;
  if (!amount || !phone) {
    return res.status(400).json({ error: 'amount and phone are required' });
  }
  try {
    const params = new URLSearchParams({
      amount: String(amount),
      currency: 'thb',
      'source[type]': 'truemoney_wallet',
      'source[phone_number]': phone,
    });
    const response = await fetch('https://api.omise.co/charges', {
      method: 'POST',
      headers: {
        Authorization: omiseAuthHeader(req.session.merchant.secretKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll a charge's status (used by the QR flow to detect payment completion)
app.get('/api/charge-status/:id', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`https://api.omise.co/charges/${req.params.id}`, {
      headers: { Authorization: omiseAuthHeader(req.session.merchant.secretKey) },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const MOBILE_BANKING_TYPES = {
  scb: 'mobile_banking_scb',
  kbank: 'mobile_banking_kbank',
  bbl: 'mobile_banking_bbl',
  bay: 'mobile_banking_bay',
  ktb: 'mobile_banking_ktb',
};

// Create a Mobile Banking charge
app.post('/api/charge-mobilebanking', requireAuth, async (req, res) => {
  const { amount, bank, returnUri } = req.body;
  const sourceType = MOBILE_BANKING_TYPES[bank];
  if (!amount || !sourceType) {
    return res.status(400).json({ error: 'amount and a valid bank are required' });
  }
  try {
    const params = new URLSearchParams({
      amount: String(amount),
      currency: 'thb',
      'source[type]': sourceType,
    });
    if (returnUri) params.set('return_uri', returnUri);
    const response = await fetch('https://api.omise.co/charges', {
      method: 'POST',
      headers: {
        Authorization: omiseAuthHeader(req.session.merchant.secretKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List recent charges (for the dashboard)
app.get('/api/transactions', requireAuth, async (req, res) => {
  try {
    const response = await fetch('https://api.omise.co/charges?limit=20&order=reverse_chronological', {
      headers: { Authorization: omiseAuthHeader(req.session.merchant.secretKey) },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Omise POC running at http://localhost:${PORT}`));
