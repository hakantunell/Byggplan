# ByggPlan

ByggPlan är en mobilanpassad webbapp för att styra och dokumentera ett självbygge.

Kärnfrågan i appen är:

> Vad kan göras nu, vad måste dokumenteras och vad blockerar nästa steg?

## Beslutade principer

- Flera arbetsavsnitt kan pågå parallellt.
- Ett arbetsavsnitt kan inte avslutas förrän alla obligatoriska moment, kontroller och dokumentationskrav är uppfyllda.
- Användare kan gå framåt och läsa kommande moment, men blockerade moment kan inte slutföras.
- Registrering och ändringar kräver internetanslutning.
- Appen uppdaterar projektstatus var 60:e sekund när den är aktiv.
- Data hämtas dessutom vid sidöppning, återgång till appen och efter egna ändringar.
- Foton lagras i Cloudflare R2 och metadata i Cloudflare D1.
- Mått, kontrollvärden och annan svåråterskapad information lagras strukturerat.
- Flera användare kan arbeta samtidigt med olika moment.
- Appnotiser till arbetsledare ingår i första versionen.

## Planerad teknik

- TypeScript
- React och Vite
- PWA
- Cloudflare Workers
- Hono
- Cloudflare D1
- Cloudflare R2
- IndexedDB endast för begränsad lokal cache, inte för offline-registrering

Mer detaljer finns i katalogen `docs/`.
