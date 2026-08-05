# Cloudflare deployment via webbgränssnittet

## Backend Worker

1. Workers & Pages → Create application → Connect GitHub.
2. Välj `hakantunell/Byggplan`.
3. Project name: `byggplan-api`.
4. Build command: `npm install`.
5. Deploy command: `cd backend && npx wrangler deploy`.
6. Deploya.
7. Lägg därefter bindings i Worker-inställningarna:
   - D1 variable `DB` → database `byggplan`
   - R2 variable `FILES` → bucket `byggplan-files`
8. Lägg custom domain `api.byggplan.tunell.org`.

Eftersom Cloudflares aktuella guide inte visar ett separat fält för root directory kör deploy-kommandot uttryckligen `cd backend`.

## Frontend Pages

Skapas senare som separat Cloudflare Pages-applikation från samma repository.

- Build command: `npm install && npm run build --workspace frontend`
- Build output directory: `frontend/dist`
- Custom domain: `byggplan.tunell.org`
