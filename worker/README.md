# ByggPlan API

Cloudflare Worker + D1-backend för GitHub Pages-appen.

## Skapa databasen

```bash
cd worker
npx wrangler d1 create byggplan
```

Kopiera databasens ID till `wrangler.jsonc` och ersätt `REPLACE_WITH_D1_DATABASE_ID`.

## Skapa tabeller och exempeldata

```bash
npx wrangler d1 execute byggplan --remote --file=schema.sql
```

## Publicera Worker

```bash
npx wrangler deploy
```

Notera adressen, normalt:

```text
https://byggplan-api.<ditt-subdomännamn>.workers.dev
```

Lägg adressen i `/config.js` i repots rot:

```js
window.BYGGPLAN_CONFIG = {
  apiBaseUrl: 'https://byggplan-api.<ditt-subdomännamn>.workers.dev'
};
```

GitHub Pages-appen börjar därefter läsa och skriva permanent data via API:t.

## API

- `GET /api/health`
- `GET /api/tasks`
- `PUT /api/tasks/:taskId/requirements/:requirementId`
- `POST /api/tasks/:taskId/submit`
- `GET /api/notifications`
