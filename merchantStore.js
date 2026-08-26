const bcrypt = require('bcryptjs');

// Pilot merchants — each has their own Omise key pair, looked up dynamically
// at login instead of one static key for everyone. This list is a stand-in
// for core's merchant provisioning API (currently being spec'd) — once that
// exists, only authenticate() below needs to change to call it instead of
// searching this array. Nothing outside this file should know the keys came
// from a hardcoded list rather than a live lookup.
//
// Key material is never hardcoded here — this repo is public on GitHub, so
// each merchant's actual keys live in env vars (set in .env locally, in the
// Render dashboard in production) and are only referenced by name below.
// Adding a second pilot merchant needs its own pair of env var names.
const PILOT_MERCHANTS = [
  {
    username: 'uniqlo',
    // password: "uniqlo-demo"
    passwordHash: '$2a$10$FzrZtJ4dA4.Bbz0EfIyVXuQJ.NsASkoeRVlM8J0HtniserKU5Xkha',
    displayName: 'Uniqlo',
    logo: 'assets/store-logo.png',
    publicKey: process.env.OMISE_PUBLIC_KEY,
    secretKey: process.env.OMISE_SECRET_KEY,
  },
  {
    username: 'peterpay',
    // password: "peterpay-demo"
    passwordHash: '$2a$10$POYd5WOyVI/oaTi/CgLw3uEL46jQfkI1kWQPNyKkro7V1eHzeSEt6',
    displayName: 'Peter Pay',
    logo: null,
    // No live Omise account yet — placeholder keys until Peter sets
    // OMISE_PETERPAY_PUBLIC_KEY / OMISE_PETERPAY_SECRET_KEY in .env / Render.
    publicKey: process.env.OMISE_PETERPAY_PUBLIC_KEY || 'pkey_test_placeholder_peterpay',
    secretKey: process.env.OMISE_PETERPAY_SECRET_KEY || 'skey_test_placeholder_peterpay',
  },
];

// Returns { username, displayName, logo, publicKey, secretKey } on success, null on bad credentials.
async function authenticate(username, password) {
  const merchant = PILOT_MERCHANTS.find((m) => m.username === username);
  const ok = merchant && await bcrypt.compare(password || '', merchant.passwordHash);
  if (!ok) return null;
  return {
    username: merchant.username,
    displayName: merchant.displayName,
    logo: merchant.logo,
    publicKey: merchant.publicKey,
    secretKey: merchant.secretKey,
  };
}

module.exports = { authenticate };
