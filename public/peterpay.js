let pollInterval = null;
let currentAmountBaht = 0;
let omisePublicKey = null;

function updateBrandBanner(branding) {
  const logoImg = document.getElementById('store-logo-img');
  const nameText = document.getElementById('store-name-text');
  if (branding.logo) {
    logoImg.src = branding.logo;
    logoImg.style.display = 'block';
    nameText.style.display = 'none';
  } else {
    logoImg.style.display = 'none';
    nameText.textContent = branding.displayName || '';
    nameText.style.display = 'inline-block';
  }
}

const RESTRICTABLE_METHODS = {
  card: 'btn-select-card',
  qr: 'btn-select-qr',
  mobilebanking: 'btn-select-mobilebanking',
};

function updateMethodAvailability(enabledMethods) {
  Object.entries(RESTRICTABLE_METHODS).forEach(([key, btnId]) => {
    const btn = document.getElementById(btnId);
    const enabled = !enabledMethods || enabledMethods.includes(key);
    btn.disabled = !enabled;
    btn.classList.toggle('disabled', !enabled);
    let tag = btn.querySelector('.coming-soon');
    if (!enabled && !tag) {
      tag = document.createElement('span');
      tag.className = 'coming-soon';
      tag.textContent = 'Coming soon';
      btn.appendChild(tag);
    } else if (enabled && tag) {
      tag.remove();
    }
  });
}

async function init() {
  const res = await fetch('/api/peterpay/config');
  const config = await res.json();
  omisePublicKey = config.publicKey;
  Omise.setPublicKey(omisePublicKey);
  updateBrandBanner(config);
  updateMethodAvailability(config.enabledMethods);
  showScreen('screen-amount');
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

// --- Screen: amount -> method ---
document.getElementById('btn-to-method').addEventListener('click', () => {
  currentAmountBaht = parseFloat(document.getElementById('amount-input').value) || 0;
  document.getElementById('method-amount-preview').textContent = formatBaht(currentAmountBaht);
  showScreen('screen-method');
});

// --- Screen: method -> card ---
document.getElementById('btn-select-card').addEventListener('click', () => {
  document.getElementById('card-amount-preview').textContent = formatBaht(currentAmountBaht);
  setStatus('card-status', '', 'pending');
  document.getElementById('card-form').reset();
  showScreen('screen-card');
});

// --- Screen: method -> QR ---
document.getElementById('btn-select-qr').addEventListener('click', () => {
  document.getElementById('qr-amount-preview').textContent = formatBaht(currentAmountBaht);
  document.getElementById('qr-image-wrap').innerHTML = '';
  startQrCharge();
  showScreen('screen-qr');
});

// --- Screen: method -> mobile banking bank select ---
document.getElementById('btn-select-mobilebanking').addEventListener('click', () => {
  document.getElementById('mobilebanking-amount-preview').textContent = formatBaht(currentAmountBaht);
  setStatus('mobilebanking-status', '', 'pending');
  document.getElementById('mobilebanking-action-wrap').innerHTML = '';
  showScreen('screen-mobilebanking');
});

document.querySelectorAll('.bank-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    clearInterval(pollInterval);
    const bank = btn.dataset.bank;
    const amountSatang = Math.round(currentAmountBaht * 100);

    setStatus('mobilebanking-status', `Opening ${btn.textContent}…`, 'pending');
    document.getElementById('mobilebanking-action-wrap').innerHTML = '';

    try {
      const res = await fetch('/api/peterpay/charge-mobilebanking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountSatang, bank, returnUri: window.location.href }),
      });
      const data = await res.json();
      if (data.object === 'error') {
        setStatus('mobilebanking-status', `Failed: ${data.message}`, 'error');
        return;
      }

      const authorizeUri = data.authorize_uri || (data.source && data.source.authorize_uri);
      if (authorizeUri) {
        document.getElementById('mobilebanking-action-wrap').innerHTML =
          `<a href="${authorizeUri}" target="_blank" rel="noopener" class="btn primary" style="display:block;text-align:center;text-decoration:none;margin-top:10px;">Continue to ${btn.textContent}</a>`;
        setStatus('mobilebanking-status', 'Waiting for customer to confirm in their banking app…', 'pending');
      } else {
        setStatus('mobilebanking-status', `Waiting for confirmation — ${data.id}`, 'pending');
      }

      pollInterval = setInterval(async () => {
        const statusRes = await fetch(`/api/peterpay/charge-status/${data.id}`);
        const statusData = await statusRes.json();
        if (statusData.status === 'successful') {
          clearInterval(pollInterval);
          showDone(true, data.id);
        } else if (statusData.status === 'failed' || statusData.status === 'expired') {
          clearInterval(pollInterval);
          setStatus('mobilebanking-status', `Payment ${statusData.status}`, 'error');
        }
      }, 3000);
    } catch (err) {
      setStatus('mobilebanking-status', `Request failed: ${err.message}`, 'error');
    }
  });
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
      const res = await fetch('/api/peterpay/charge-card', {
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
    const res = await fetch('/api/peterpay/charge-qr', {
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
      const statusRes = await fetch(`/api/peterpay/charge-status/${data.id}`);
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
  document.getElementById('done-amount').textContent = formatBaht(currentAmountBaht);
  document.getElementById('done-charge-id').textContent = chargeId;
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
