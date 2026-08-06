let pollInterval = null;
let currentAmountBaht = 0;
let omisePublicKey = null;
let googlePaymentsClient = null;

async function init() {
  const res = await fetch('/api/config');
  const config = await res.json();
  if (!config.publicKey) {
    console.warn('No public key returned from /api/config — check your .env file.');
    return;
  }
  omisePublicKey = config.publicKey;
  Omise.setPublicKey(omisePublicKey);
}
init();

// Called by the Google Pay script tag once it loads
function onGooglePayLoaded() {
  googlePaymentsClient = new google.payments.api.PaymentsClient({ environment: 'TEST' });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function formatBaht(amount) {
  return `฿${amount.toFixed(2)}`;
}

// --- Back buttons ---
document.querySelectorAll('.back').forEach((btn) => {
  btn.addEventListener('click', () => {
    clearInterval(pollInterval);
    showScreen(btn.dataset.back);
  });
});

// --- Screen 1 -> Dashboard ---
document.getElementById('btn-to-dashboard').addEventListener('click', async () => {
  showScreen('screen-dashboard');
  setStatus('dashboard-status', 'Loading…', 'pending');
  document.getElementById('transactions-list').innerHTML = '';

  try {
    const res = await fetch('/api/transactions');
    const data = await res.json();
    if (data.object === 'error') {
      setStatus('dashboard-status', `Failed to load: ${data.message}`, 'error');
      return;
    }
    const charges = data.data || [];
    if (charges.length === 0) {
      setStatus('dashboard-status', 'No transactions yet.', 'pending');
      return;
    }
    setStatus('dashboard-status', '', 'pending');
    document.getElementById('transactions-list').innerHTML = charges.map(renderTxRow).join('');
  } catch (err) {
    setStatus('dashboard-status', `Request failed: ${err.message}`, 'error');
  }
});

function renderTxRow(charge) {
  const amountBaht = (charge.amount || 0) / 100;
  const method = charge.source && charge.source.type
    ? charge.source.type.replace(/_/g, ' ')
    : (charge.card ? `card •••• ${charge.card.last_digits}` : 'unknown');
  const statusClass = charge.status === 'successful' ? 'success'
    : charge.status === 'failed' ? 'error' : 'pending';
  const time = charge.created_at ? new Date(charge.created_at).toLocaleString() : '';
  return `
    <div class="tx-row">
      <div class="tx-main">
        <span class="tx-amount">${formatBaht(amountBaht)}</span>
        <span class="tx-status ${statusClass}">${charge.status}</span>
      </div>
      <div class="tx-meta">
        <span>${method}</span>
        <span>${time}</span>
      </div>
    </div>`;
}

// --- Screen 1 -> 2 ---
document.getElementById('btn-to-method').addEventListener('click', () => {
  currentAmountBaht = parseFloat(document.getElementById('amount-input').value) || 0;
  document.getElementById('method-amount-preview').textContent = formatBaht(currentAmountBaht);
  showScreen('screen-method');
});

// --- Screen 2 -> 3a (card) ---
document.getElementById('btn-select-card').addEventListener('click', () => {
  document.getElementById('card-amount-preview').textContent = formatBaht(currentAmountBaht);
  setStatus('card-status', '', 'pending');
  document.getElementById('card-form').reset();
  showScreen('screen-card');
});

// --- Screen 2 -> 3b (QR) ---
document.getElementById('btn-select-qr').addEventListener('click', () => {
  document.getElementById('qr-amount-preview').textContent = formatBaht(currentAmountBaht);
  document.getElementById('qr-image-wrap').innerHTML = '';
  startQrCharge();
  showScreen('screen-qr');
});

// --- Screen 2 -> 3d (TrueMoney Wallet) ---
document.getElementById('btn-select-truemoney').addEventListener('click', () => {
  document.getElementById('truemoney-amount-preview').textContent = formatBaht(currentAmountBaht);
  setStatus('truemoney-status', '', 'pending');
  document.getElementById('truemoney-action-wrap').innerHTML = '';
  document.getElementById('truemoney-form').reset();
  showScreen('screen-truemoney');
});

const truemoneyForm = document.getElementById('truemoney-form');
truemoneyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearInterval(pollInterval);
  const amountSatang = Math.round(currentAmountBaht * 100);
  const phone = document.getElementById('truemoney-phone').value;

  setStatus('truemoney-status', 'Sending payment request…', 'pending');
  document.getElementById('truemoney-action-wrap').innerHTML = '';

  try {
    const res = await fetch('/api/charge-truemoney', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountSatang, phone }),
    });
    const data = await res.json();
    if (data.object === 'error') {
      setStatus('truemoney-status', `Failed: ${data.message}`, 'error');
      return;
    }

    const authorizeUri = data.authorize_uri || (data.source && data.source.authorize_uri);
    if (authorizeUri) {
      document.getElementById('truemoney-action-wrap').innerHTML =
        `<a href="${authorizeUri}" target="_blank" rel="noopener" class="btn primary" style="display:block;text-align:center;text-decoration:none;margin-top:10px;">Continue in TrueMoney</a>`;
      setStatus('truemoney-status', 'Waiting for customer to confirm in TrueMoney…', 'pending');
    } else {
      setStatus('truemoney-status', `Waiting for OTP confirmation — ${data.id}`, 'pending');
    }

    pollInterval = setInterval(async () => {
      const statusRes = await fetch(`/api/charge-status/${data.id}`);
      const statusData = await statusRes.json();
      if (statusData.status === 'successful') {
        clearInterval(pollInterval);
        showDone(true, data.id);
      } else if (statusData.status === 'failed' || statusData.status === 'expired') {
        clearInterval(pollInterval);
        setStatus('truemoney-status', `Payment ${statusData.status}`, 'error');
      }
    }, 3000);
  } catch (err) {
    setStatus('truemoney-status', `Request failed: ${err.message}`, 'error');
  }
});

// --- Screen 2 -> 3c (wallet: Apple Pay / Google Pay) ---
document.getElementById('btn-select-wallet').addEventListener('click', () => {
  document.getElementById('wallet-amount-preview').textContent = formatBaht(currentAmountBaht);
  setStatus('wallet-status', '', 'pending');
  showScreen('screen-wallet');
});

document.getElementById('btn-apple-pay').addEventListener('click', () => {
  setStatus(
    'wallet-status',
    'Not connected: needs an Apple Developer account, Merchant ID, and domain verification — a separate setup project, not a code change. See README.',
    'error'
  );
});

document.getElementById('btn-google-pay').addEventListener('click', async () => {
  if (!googlePaymentsClient) {
    setStatus('wallet-status', 'Google Pay script still loading — try again in a second.', 'error');
    return;
  }

  const amountSatang = Math.round(currentAmountBaht * 100);
  const paymentDataRequest = {
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: [{
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY'],
        allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'JCB'],
      },
      tokenizationSpecification: {
        type: 'PAYMENT_GATEWAY',
        parameters: {
          gateway: 'omise',
          gatewayMerchantId: omisePublicKey,
        },
      },
    }],
    merchantInfo: { merchantName: 'Omise Pay POC' },
    transactionInfo: {
      totalPriceStatus: 'FINAL',
      totalPrice: currentAmountBaht.toFixed(2),
      currencyCode: 'THB',
      countryCode: 'TH',
    },
  };

  try {
    setStatus('wallet-status', 'Opening Google Pay…', 'pending');
    const paymentData = await googlePaymentsClient.loadPaymentData(paymentDataRequest);
    const gpayToken = paymentData.paymentMethodData.tokenizationData.token;

    setStatus('wallet-status', 'Creating card token…', 'pending');
    Omise.createToken('tokenization', { method: 'googlepay', data: gpayToken }, async (statusCode, response) => {
      if (statusCode !== 200) {
        setStatus('wallet-status', `Tokenization failed: ${response.message || 'is Google Pay enabled on your Omise account?'}`, 'error');
        return;
      }
      setStatus('wallet-status', 'Charging…', 'pending');
      try {
        const res = await fetch('/api/charge-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: response.id, amount: amountSatang }),
        });
        const data = await res.json();
        if (data.object === 'error') {
          setStatus('wallet-status', `Charge failed: ${data.message}`, 'error');
        } else if (data.status === 'successful') {
          showDone(true, data.id);
        } else {
          setStatus('wallet-status', `Charge status: ${data.status}`, 'error');
        }
      } catch (err) {
        setStatus('wallet-status', `Request failed: ${err.message}`, 'error');
      }
    });
  } catch (err) {
    if (err.statusCode === 'CANCELED') {
      setStatus('wallet-status', 'Cancelled.', 'pending');
    } else {
      setStatus('wallet-status', `Google Pay error: ${err.message || err.statusCode}`, 'error');
    }
  }
});

// --- Card charge ---
const cardForm = document.getElementById('card-form');
cardForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const amountSatang = Math.round(currentAmountBaht * 100);

  setStatus('card-status', 'Tokenizing card…', 'pending');

  Omise.createToken('card', {
    name: document.getElementById('card-name').value,
    number: document.getElementById('card-number').value.replace(/\s/g, ''),
    expiration_month: document.getElementById('card-exp-month').value,
    expiration_year: document.getElementById('card-exp-year').value,
    security_code: document.getElementById('card-cvv').value,
  }, async (statusCode, response) => {
    if (statusCode !== 200) {
      setStatus('card-status', `Tokenization failed: ${response.message || 'unknown error'}`, 'error');
      return;
    }
    setStatus('card-status', 'Charging card…', 'pending');
    try {
      const res = await fetch('/api/charge-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: response.id, amount: amountSatang }),
      });
      const data = await res.json();
      if (data.object === 'error') {
        setStatus('card-status', `Charge failed: ${data.message}`, 'error');
      } else if (data.status === 'successful') {
        showDone(true, data.id);
      } else if (data.status === 'failed') {
        setStatus('card-status', `Charge failed: ${data.failure_message || data.failure_code}`, 'error');
      } else {
        setStatus('card-status', `Charge status: ${data.status} (${data.id})`, 'pending');
      }
    } catch (err) {
      setStatus('card-status', `Request failed: ${err.message}`, 'error');
    }
  });
});

// --- QR charge ---
async function startQrCharge() {
  clearInterval(pollInterval);
  const amountSatang = Math.round(currentAmountBaht * 100);
  setStatus('qr-status', 'Generating QR code…', 'pending');

  try {
    const res = await fetch('/api/charge-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountSatang }),
    });
    const data = await res.json();
    if (data.object === 'error') {
      setStatus('qr-status', `Failed: ${data.message}`, 'error');
      return;
    }
    const qrUri = data.source && data.source.scannable_code && data.source.scannable_code.image
      ? data.source.scannable_code.image.download_uri
      : null;
    if (!qrUri) {
      setStatus('qr-status', 'No QR returned — PromptPay may not be enabled on this account yet.', 'error');
      return;
    }
    document.getElementById('qr-image-wrap').innerHTML =
      `<img src="${qrUri}" alt="PromptPay QR code" class="qr-image">`;
    setStatus('qr-status', 'Waiting for payment…', 'pending');

    pollInterval = setInterval(async () => {
      const statusRes = await fetch(`/api/charge-status/${data.id}`);
      const statusData = await statusRes.json();
      if (statusData.status === 'successful') {
        clearInterval(pollInterval);
        showDone(true, data.id);
      } else if (statusData.status === 'failed' || statusData.status === 'expired') {
        clearInterval(pollInterval);
        setStatus('qr-status', `Payment ${statusData.status}`, 'error');
      }
    }, 3000);
  } catch (err) {
    setStatus('qr-status', `Request failed: ${err.message}`, 'error');
  }
}

// --- Done screen ---
function showDone(success, chargeId) {
  document.getElementById('done-title').textContent = success ? 'Payment received' : 'Payment failed';
  document.getElementById('done-amount').textContent = `${formatBaht(currentAmountBaht)} — ${chargeId}`;
  showScreen('screen-done');
}

document.getElementById('btn-new-charge').addEventListener('click', () => {
  document.getElementById('amount-input').value = '1.00';
  showScreen('screen-amount');
});

function setStatus(elId, msg, type) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = `status ${type}`;
}
