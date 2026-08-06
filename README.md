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

**TrueMoney Wallet path:**
- Enter any Thai-format phone number, e.g. `0812345678`
- Submits to Omise as a `truemoney_wallet` source — in test mode you'll either see a
  "Continue in TrueMoney" link (if Omise returns an `authorize_uri`) or it'll sit waiting
  for OTP confirmation
- Mark the pending test charge "Successful" from your Omise dashboard the same way as QR
  to move it to the confirmation screen

## Google Pay — now live in this POC

Real integration, using Google's TEST environment (no Google Pay Business Console
registration needed for testing — only required to go live).

**Prerequisite:** Google Pay needs to be enabled on your Omise account. Email
support@omise.co requesting it. Try the button first — if tokenization fails with a
generic error, that's the fix.

**How it works:** tapping the Google Pay button opens Google's payment sheet →
Google returns a token → `Omise.createToken('tokenization', { method: 'googlepay', data: token }, ...)`
converts it to a card token → charged through the existing `/api/charge-card` route,
same as a normal card.

**Testing it:** in Google's TEST environment, the card number in the token is always
`4111 1111 1111 1111` — chargeable directly with your Omise test key, no real Google
Account or real card needed. Just click the button and confirm in the payment sheet
that appears.

**Going live later** needs a real Google Pay Business Console merchant ID
(`gatewayMerchantId` currently uses your Omise public key, which is correct per Omise's
integration — the `merchantId` in `merchantInfo` is what's missing for production).
See: https://docs.omise.co/googlepay

## Apple Pay — still a stub, and it's a real project, not a quick add

Unlike Google Pay, there's no shortcut here — Apple Pay web integration requires:

1. An **Apple Developer Program membership** ($99/year) — someone with authority to
   set this up for the company (likely not something to spin up personally)
2. An **Apple Merchant ID**, created in the Apple Developer portal
3. Emailing Omise (support@omise.co) with that Merchant ID to get a Certificate Signing
   Request, which becomes your Payment Processing Certificate
4. **Domain verification** — Omise sends a domain association file, which needs to be
   hosted at `/.well-known/apple-developer-merchantid-domain-association` on the live
   HTTPS domain (Render gives you HTTPS automatically, so that part's fine once you're
   at this step)
5. Server-side merchant validation using the Apple Merchant Identity Certificate,
   per Apple's "Requesting an Apple Pay Payment Session" guide
6. Testing requires an **Apple sandbox tester account** and only works in **Safari**,
   ideally on real Apple hardware (Touch ID / Face ID)

This is realistically a multi-week task involving Apple Developer account access,
not something to build in this POC session. Worth scoping separately if you want to
actually pursue it — happy to help plan it out once you know who owns the Apple
Developer account on your side.

See: https://docs.omise.co/applepay

## Tap-to-pay for a physical contactless card

Still not achievable in a web app — this is a different capability from Apple/Google
Pay above. Reading a physical contactless card requires a certified terminal SDK
(Stripe Terminal, Visa's Tap to Pay SDK) plus a native app; Omise doesn't currently
publish one. Separate, bigger initiative from either wallet integration above.

## Recent transactions dashboard

Tap "View recent transactions" from the amount screen. Pulls the last 20 charges via
Omise's List Charges API (`GET /charges?limit=20&order=reverse_chronological`) — shows
amount, status, method, and timestamp for each. Read-only, no new charge is created.

## Logos / branding

Drop these into `public/assets/` (same filenames):
- `omise-logo.png` — shown in the header banner
- `store-logo.png` — shown in the store banner strip (currently just says "UNIQLO" as text)

**On the Uniqlo branding specifically:** I didn't fetch or embed Uniqlo's actual logo —
that's someone else's trademark, not something to pull in without a real reason (an
actual pilot/demo agreement with them). Right now it's just styled text. If you want
their real logo in there, that's your call to make with an actual asset file, not
something to source and drop in casually.

## Tap-to-pay for card entry

Still not achievable in a web app — see the note in the Apple Pay / Google Pay section
above. Nothing new here; the constraint is the same (native app + certified terminal SDK
required for reading a physical contactless card).

## How it maps to the Omise API

| Action | Endpoint |
|---|---|
| Tokenize card (browser, public key) | `Omise.createToken('card', ...)` → `POST vault.omise.co/tokens` |
| Charge the token (server, secret key) | `POST api.omise.co/charges` with `card=tokn_...` |
| Create PromptPay QR (server, secret key) | `POST api.omise.co/charges` with `source[type]=promptpay` |
| Create TrueMoney Wallet charge (server, secret key) | `POST api.omise.co/charges` with `source[type]=truemoney_wallet` + `source[phone_number]` |
| Poll charge status | `GET api.omise.co/charges/{id}` |

## Notes / next steps for a real integration

- This POC uses THB only — extend the currency param if you need multi-currency.
- Add the `charge.complete` webhook instead of polling for production (see Omise's Webhooks docs) — polling is fine for a demo but wastes requests at scale.
- The classic "Links API" (hosted payment page, one API call) is closed to new Omise accounts as of Aug 2024 — new integrations should use Payment Links+ instead if you want a no-code hosted link rather than building your own form.
