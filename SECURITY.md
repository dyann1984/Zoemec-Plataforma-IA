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

## Reporting Issues

For security concerns, contact the repository owner directly. Do not open public issues containing credentials, screenshots of secrets or private customer data.
