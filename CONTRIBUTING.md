# Contributing

ZOEMEC AI is currently maintained as a private product repository. Contributions should protect technical credibility, user data and construction-domain accuracy.

## Development Principles

- Keep AI-assisted output editable and auditable.
- Do not commit secrets, `.env` files, service-account JSON or private client data.
- Prefer small, traceable pull requests.
- Validate imports, exports and authentication flows before merging.
- Do not claim a feature is complete unless it is implemented and tested.

## Local Workflow

```bash
npm install
npm run dev
npm run build
```

The current `main` branch exposes `dev`, `build` and `preview` scripts. If lint or test scripts are added later, run them before opening a pull request.

## Documentation

Update `README.md`, `docs/ARCHITECTURE.md` and `docs/DEMO.md` when a change affects product behavior, deployment or demo flow.
