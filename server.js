require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const OMISE_SECRET_KEY = process.env.OMISE_SECRET_KEY;
const OMISE_PUBLIC_KEY = process.env.OMISE_PUBLIC_KEY;

if (!OMISE_SECRET_KEY || !OMISE_PUBLIC_KEY) {
  console.warn('⚠️  Missing OMISE_SECRET_KEY or OMISE_PUBLIC_KEY — copy .env.example to .env and fill them in.');
}

function omiseAuthHeader() {
  return 'Basic ' + Buffer.from(`${OMISE_SECRET_KEY}:`).toString('base64');
}

// Frontend needs the public key to initialize Omise.js — never expose the secret key.
app.get('/api/config', (req, res) => {
  res.json({ publicKey: OMISE_PUBLIC_KEY });
});

// Charge a tokenized card (token created client-side via Omise.js)
app.post('/api/charge-card', async (req, res) => {
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
        Authorization: omiseAuthHeader(),
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
app.post('/api/charge-qr', async (req, res) => {
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
        Authorization: omiseAuthHeader(),
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
app.post('/api/charge-truemoney', async (req, res) => {
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
        Authorization: omiseAuthHeader(),
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
app.get('/api/charge-status/:id', async (req, res) => {
  try {
    const response = await fetch(`https://api.omise.co/charges/${req.params.id}`, {
      headers: { Authorization: omiseAuthHeader() },
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
app.post('/api/charge-mobilebanking', async (req, res) => {
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
        Authorization: omiseAuthHeader(),
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
app.get('/api/transactions', async (req, res) => {
  try {
    const response = await fetch('https://api.omise.co/charges?limit=20&order=reverse_chronological', {
      headers: { Authorization: omiseAuthHeader() },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Omise POC running at http://localhost:${PORT}`));
