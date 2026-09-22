const answers = {};

// Build yes/no/unsure buttons for each risk question, or yes/no for the
// one informational (non-scoring) question flagged with data-binary.
document.querySelectorAll('.fl-question').forEach((q) => {
  const field = q.dataset.field;
  const optsWrap = q.querySelector('.fl-options');
  const options = optsWrap.dataset.binary ? ['yes', 'no'] : ['yes', 'no', 'unsure'];
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fl-opt-btn';
    btn.textContent = opt[0].toUpperCase() + opt.slice(1);
    btn.addEventListener('click', () => {
      answers[field] = opt;
      optsWrap.querySelectorAll('.fl-opt-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    optsWrap.appendChild(btn);
  });
});

const VERDICT_COPY = {
  fastlane: {
    title: 'Looks like a Fast Lane candidate',
    note: 'No disqualifying risk flagged. This is a self-assessment — Engineering still needs to confirm the risk classification before any work starts.',
  },
  review: {
    title: 'Needs a closer look',
    note: "A few answers weren't certain. Get Engineering to confirm these before deciding the track:",
  },
  standard: {
    title: 'Standard track',
    note: 'This should go through the normal engineering process, not the Fast Lane:',
  },
};

function renderVerdict(idea) {
  const wrap = document.getElementById('verdict-wrap');
  const card = document.getElementById('verdict-card');
  const copy = VERDICT_COPY[idea.verdict];
  const reasons = idea.verdict === 'review' ? idea.flags : idea.reasons;
  card.className = `fl-verdict ${idea.verdict}`;
  card.innerHTML = `
    <p class="fl-verdict-title">${copy.title}</p>
    <p class="fl-verdict-note">${copy.note}</p>
    ${reasons.length ? `<ul class="fl-verdict-reasons">${reasons.map((r) => `<li>${r}</li>`).join('')}</ul>` : ''}
  `;
  wrap.hidden = false;
}

function badgeLabel(verdict) {
  return verdict === 'fastlane' ? 'Fast Lane' : verdict === 'review' ? 'Needs Review' : 'Standard Track';
}

function renderList(ideas) {
  const list = document.getElementById('ideas-list');
  if (ideas.length === 0) {
    list.innerHTML = '<p class="fl-list-empty">No ideas submitted yet.</p>';
    return;
  }
  list.innerHTML = ideas.map((idea) => `
    <div class="fl-idea">
      <div class="fl-idea-top">
        <span class="fl-idea-title">${escapeHtml(idea.title)}</span>
        <span class="fl-badge ${idea.verdict}">${badgeLabel(idea.verdict)}</span>
      </div>
      <div class="fl-idea-meta">${escapeHtml(idea.submitter)}${idea.team ? ` · ${escapeHtml(idea.team)}` : ''} · ${new Date(idea.createdAt).toLocaleDateString()}</div>
      <div class="fl-idea-desc">${escapeHtml(idea.description)}</div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadIdeas() {
  const res = await fetch('/api/aifastlane/ideas');
  const ideas = await res.json();
  renderList(ideas);
}
loadIdeas();

function setStatus(msg, type) {
  const el = document.getElementById('form-status');
  el.textContent = msg;
  el.className = `status ${type}`;
}

const form = document.getElementById('idea-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const questionFields = ['touchesPayments', 'touchesAuthSecurity', 'touchesCore', 'touchesSensitiveData', 'largeScope', 'notReversible'];
  const missing = questionFields.some((f) => !answers[f]);
  if (missing) {
    setStatus('Please answer all the risk questions.', 'error');
    return;
  }

  setStatus('Checking…', 'pending');
  try {
    const res = await fetch('/api/aifastlane/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('f-title').value,
        submitter: document.getElementById('f-submitter').value,
        team: document.getElementById('f-team').value,
        description: document.getElementById('f-description').value,
        ...answers,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || 'Something went wrong.', 'error');
      return;
    }
    setStatus('', 'pending');
    renderVerdict(data);
    form.reset();
    document.querySelectorAll('.fl-opt-btn.selected').forEach((b) => b.classList.remove('selected'));
    Object.keys(answers).forEach((k) => delete answers[k]);
    loadIdeas();
  } catch (err) {
    setStatus(`Request failed: ${err.message}`, 'error');
  }
});
