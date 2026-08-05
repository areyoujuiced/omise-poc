# Omise Pay — Merchant Flow POC

Mimics the "Omise Pay app" merchant flow: enter amount → choose Credit Card or QR → customer
pays → confirmation. Card tokenization via Omise.js, QR via a PromptPay source, both charged
through Omise's Charges API. Secret key stays server-side; only the public key reaches the browser.

Rendered as a phone-frame UI so it reads as an app screen, not a web form — built specifically
to demo how little custom work this actually takes.

## 1. Get sandbox keys (you do this — I can't create the account for you)

1. Go to https://dashboard.omise.co and sign up (or log in if you already have an Omise account).
2. Make sure you're in **Test mode** (toggle top-left of the dashboard).
3. Go to **API > Keys**. Copy the `pkey_test_...` and `skey_test_...` values.

No approval needed for test mode — keys work immediately.

> Note: PromptPay QR needs to be enabled on the account (email support@omise.co if it's a
> brand-new account). If you're using an internal Omise account this is very likely already on.

## 2. Configure

```bash
cd omise-poc
cp .env.example .env
```

Edit `.env` and paste in your test keys:
```
OMISE_PUBLIC_KEY=pkey_test_...
OMISE_SECRET_KEY=skey_test_...
```

## 3. Install and run

```bash
npm install
npm start
```

Open http://localhost:3000

## 4. Test it

1. Enter an amount → **Continue**
2. Tap **Credit / Debit Card** or **QR Code**

**Card path:**
- Card number: `4242 4242 4242 4242`
- Any future expiry (e.g. `12` / `2027`)
- Any 3-digit CVV
- Submit → lands on the confirmation screen

**QR path:**
- QR generates immediately (test mode, real PromptPay source)
- No real bank to scan it with in test mode — go to your Omise dashboard →
  find the pending test charge → **Actions > Mark as Successful**
- The page polls every 3s and moves to the confirmation screen once you do that

## How it maps to the Omise API

| Action | Endpoint |
|---|---|
| Tokenize card (browser, public key) | `Omise.createToken('card', ...)` → `POST vault.omise.co/tokens` |
| Charge the token (server, secret key) | `POST api.omise.co/charges` with `card=tokn_...` |
| Create PromptPay QR (server, secret key) | `POST api.omise.co/charges` with `source[type]=promptpay` |
| Poll charge status | `GET api.omise.co/charges/{id}` |

## Notes / next steps for a real integration

- This POC uses THB only — extend the currency param if you need multi-currency.
- Add the `charge.complete` webhook instead of polling for production (see Omise's Webhooks docs) — polling is fine for a demo but wastes requests at scale.
- The classic "Links API" (hosted payment page, one API call) is closed to new Omise accounts as of Aug 2024 — new integrations should use Payment Links+ instead if you want a no-code hosted link rather than building your own form.
