# Contributing

## ORM choice

This repo uses **Prisma** with PostgreSQL for `@wfengine/server` (schema in [`apps/server/prisma/schema.prisma`](apps/server/prisma/schema.prisma)). If you contribute database-related changes, run migrations from `apps/server`:

```bash
export DATABASE_URL="postgresql://..."
npx prisma migrate dev --name describe_change
```

Keep **`@wfengine/core`** free of database imports so the engine stays embeddable.

## Workspace layout

- Turborepo drives `build` / `test`.
- **`apps/`** holds runnable apps (`apps/server`, `apps/studio`); **`packages/`** holds reusable libraries (`@wfengine/shared`, `@wfengine/core`, etc.).
- **`examples/programmatic`** is a small script-style sample for the engine only.
- Internal packages use semver `^0.1.0` and npm workspaces linking.

## Pull requests

- Prefer focused changes with tests (`packages/core`, `packages/ui`).  
- Run `npm run build` and `npm test` before submitting.
- When adding or changing **built-in nodes**, update **`packages/nodes-base/README.md`**, **[README.md](../README.md)** (packages table / modular install if relevant), **`FEATURES.md`**, **`PROJECT-GUIDE.md`**, and the **Studio palette** in **`apps/studio/src/App.tsx`** so docs stay aligned.
