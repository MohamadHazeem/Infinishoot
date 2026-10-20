# Optional online service

From the repository root:

```sh
npx wrangler login
npm run server:deploy
```

The command creates/reuses KV, generates the ignored `wrangler.toml` from
`wrangler.template.toml`, deploys explicitly, and prints the URL. Nothing deploys
on build, install, push or release. `npm run server:dev` runs a separate local KV.

See **[docs/ONLINE.md](../../docs/ONLINE.md)** for the complete first-time setup,
GitHub Pages and desktop build variables, local test links, endpoint validation,
free-tier budgets and the limits of KV's best-effort boards and rate controls.
