const fs = require('fs');
const path = require('path');

// Ideas submitted through /fastlane, persisted to a JSON file rather than
// a database — this is an internal screening tool, not customer-facing,
// and doesn't warrant a real DB dependency. Not committed to git (see
// .gitignore) since submissions may describe unreleased business ideas.
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'fastlane-ideas.json');

function loadIdeas() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function saveIdeas(ideas) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(ideas, null, 2));
}

// Risk questions, each answered 'yes' | 'no' | 'unsure'. A 'yes' on any of
// these disqualifies the idea from the Fast Lane outright — these mirror
// the exclusion list in the Fast Lane doc (payments, auth, core systems,
// sensitive/regulated data) plus reversibility and cross-team scope.
const DISQUALIFIERS = [
  { field: 'touchesPayments', onYes: 'Touches payment processing, authorization, or settlement' },
  { field: 'touchesAuthSecurity', onYes: 'Touches authentication or core security infrastructure' },
  { field: 'touchesCore', onYes: "Touches Omise's core production systems" },
  { field: 'touchesSensitiveData', onYes: 'Involves sensitive customer data or regulatory requirements' },
  { field: 'largeScope', onYes: 'Large scope with significant cross-team dependencies' },
  { field: 'notReversible', onYes: "Can't be rolled back or disabled quickly if something goes wrong" },
];

// Returns { verdict: 'fastlane' | 'review' | 'standard', reasons: string[], flags: string[] }
function evaluate(answers) {
  const reasons = [];
  const flags = [];

  for (const { field, onYes } of DISQUALIFIERS) {
    const answer = answers[field];
    if (answer === 'yes') reasons.push(onYes);
    else if (answer === 'unsure') flags.push(onYes);
  }

  let verdict;
  if (reasons.length > 0) verdict = 'standard';
  else if (flags.length > 0) verdict = 'review';
  else verdict = 'fastlane';

  return { verdict, reasons, flags };
}

function submitIdea(data) {
  const { title, description, submitter } = data;
  if (!title || !description || !submitter) {
    return { error: 'Title, description, and submitter are required.' };
  }

  const { verdict, reasons, flags } = evaluate(data);
  const idea = {
    id: `idea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: title.trim(),
    description: description.trim(),
    submitter: submitter.trim(),
    team: (data.team || '').trim(),
    answers: {
      touchesPayments: data.touchesPayments,
      touchesAuthSecurity: data.touchesAuthSecurity,
      touchesCore: data.touchesCore,
      touchesSensitiveData: data.touchesSensitiveData,
      largeScope: data.largeScope,
      notReversible: data.notReversible,
      internalToolOnly: data.internalToolOnly || null,
    },
    verdict,
    reasons,
    flags,
    createdAt: new Date().toISOString(),
  };

  const ideas = loadIdeas();
  ideas.unshift(idea);
  saveIdeas(ideas);
  return { idea };
}

function listIdeas() {
  return loadIdeas();
}

module.exports = { submitIdea, listIdeas };
