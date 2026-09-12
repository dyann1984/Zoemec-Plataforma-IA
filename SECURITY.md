# Security Policy

## Sensitive Data

Never commit:

- `.env` files;
- OpenAI API keys;
- Firebase Admin service-account JSON;
- private keys;
- Mercado Pago or payment-provider tokens;
- private construction libraries;
- real client confidential documents.

## Environment Variables

Use `.env.example` as a template only. Real values must be configured locally or in Vercel project settings.

Server-side variables such as `OPENAI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PRIVATE_KEY` and `MP_ACCESS_TOKEN` must never be exposed in React code.

## Firebase

- Review `firestore.rules` and `storage.rules` before production releases.
- Keep admin operations behind server-side routes.
- Validate authentication before reading or writing protected user data.

## Global administrator (`super_admin`)

`super_admin` is the platform-wide administrator role (not to be confused
with `company_manager`, the per-organization role — see
`src/domain/organization.js#ORG_ROLE`). It must stay exclusive to the
project owner's own account.

- **Final mechanism**: a real Firebase custom claim (`super_admin === true`).
  No deployed endpoint, Firestore write, Team Panel, or Admin Panel action in
  this codebase ever sets this claim — it can only be granted by running
  `scripts/grant-super-admin.mjs` by hand, from a terminal, with real
  Firebase Admin credentials (the same `FIREBASE_SERVICE_ACCOUNT_JSON` the
  server already uses). See that script's header for exact usage
  (`node scripts/grant-super-admin.mjs <email>`, plus `--revoke`).
- **Transitional fallback (not the final mechanism)**: an exact-email check
  (`SUPERADMIN_EMAILS`, hardcoded to the owner's account) exists in exactly
  three places — `src/domain/permissions.js`, `server/api-lib/_authGuard.mjs`,
  and `firestore.rules#isSuperAdmin()` — kept in sync. It exists only so
  access is never lost in an environment where the custom claim hasn't been
  granted yet. Once `scripts/grant-super-admin.mjs` has been run for the real
  account in a given environment, this fallback can be removed from all
  three files without losing access.
- After granting or revoking the claim, the affected account must sign out
  and back in (or force a token refresh) — Firebase custom claims never
  apply retroactively to an already-issued ID token.

## Reporting Issues

For security concerns, contact the repository owner directly. Do not open public issues containing credentials, screenshots of secrets or private customer data.
