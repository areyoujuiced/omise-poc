let pollInterval = null;
let currentAmountBaht = 0;

async function init() {
  const res = await fetch('/api/config');
  const config = await res.json();
  if (!config.publicKey) {
    console.warn('No public key returned from /api/config — check your .env file.');
    return;
  }
  Omise.setPublicKey(config.publicKey);
}
init();

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

// --- Screen 2 -> 3c (wallet: Apple Pay / Google Pay) ---
document.getElementById('btn-select-wallet').addEventListener('click', () => {
  document.getElementById('wallet-amount-preview').textContent = formatBaht(currentAmountBaht);
  setStatus('wallet-status', '', 'pending');
  showScreen('screen-wallet');
});

document.getElementById('btn-apple-pay').addEventListener('click', () => {
  setStatus(
    'wallet-status',
    'Not connected: needs an Apple Merchant ID + domain verification file before this can charge a real card.',
    'error'
  );
});

document.getElementById('btn-google-pay').addEventListener('click', () => {
  setStatus(
    'wallet-status',
    'Not connected: needs a Google Pay Business Console merchant ID before this can charge a real card.',
    'error'
  );
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
  document.getElementById('amount-input').value = '100.00';
  showScreen('screen-amount');
});

function setStatus(elId, msg, type) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = `status ${type}`;
}
