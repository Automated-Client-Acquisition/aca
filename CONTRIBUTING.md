# Contributing

Thanks for helping. ACA is a working product with paying customers, so changes land when they are
small, tested and easy to review.

## Before you start

- **Bugs:** open an issue with steps to reproduce, what you expected and what happened.
- **Features:** open an issue first and describe the problem you want solved. A short discussion
  saves you building something that won't be merged.
- **Security issues:** don't open an issue. See [SECURITY.md](SECURITY.md).

## Set up

Follow [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) with a local Supabase (`supabase start`), then:

```bash
npm ci
npm run dev        # http://localhost:3001
```

## Pull requests

1. One change per pull request, with a description of what and why.
2. `npm run lint` and `npm run build` pass. CI also builds the database from the baseline and checks
   the tree for secrets.
3. Follow the code around you: TanStack Query hooks scoped to the current organization, `@/` imports,
   shared edge-function helpers in `supabase/functions/_shared/`.
4. Database changes go in a new, idempotent migration in `supabase/migrations/`
   (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP ... IF EXISTS` before `CREATE`).
5. Never commit a key, token or password, not even an expired one.

## Contributor License Agreement

The first time you open a pull request, the CLA bot asks you to sign the
[Contributor License Agreement](CLA.md) by leaving a comment. It keeps your copyright with you and
lets us ship your contribution under ACA's license, its future Apache 2.0 license and in ACA Cloud.

## Support

Self-hosting is supported by the community: GitHub issues and discussions. If you'd rather not run
it yourself, ACA Cloud is $67 a month and includes support.
