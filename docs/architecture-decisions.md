# Arkitekturbeslut

## ADR-001: Onlinekrav för registrering

Alla ändringar kräver en fungerande anslutning till servern. Detta gäller bland annat:

- registrering av mått och kontrollvärden
- statusändringar
- kommentarer och avvikelser
- tilldelning av moment
- uppladdning och koppling av foton
- avslut av moment och arbetsavsnitt

När appen är offline får användaren läsa information som redan finns i webbläsarens cache, men inga ändringar får registreras.

### Motiv

Full offline-synkronisering mellan flera samtidiga användare skulle kräva konflikthantering, lokala transaktionsköer och sammanslagning av ändringar. Detta behövs inte i första versionen och skulle öka risken för att kritisk byggdokumentation blir inkonsekvent.

## ADR-002: Begränsad lokal cache

IndexedDB används som en inbyggd webbläsardatabas för cache av senast hämtad information. Ingen separat installation krävs.

Cache får användas för:

- senast visade arbetsavsnitt och moment
- referensdata och användarinställningar
- navigationstillstånd
- utkast som ännu inte räknas som registrerade

Cache får inte betraktas som projektets primära datakälla.

## ADR-003: Uppdatering var 60:e sekund

När appen är synlig och aktiv gör klienten en förändringskontroll var 60:e sekund.

Uppdatering sker också:

- när appen öppnas
- när ett arbetsavsnitt öppnas
- när appen återgår från bakgrunden
- efter att användaren själv har sparat en ändring
- när användaren trycker på Uppdatera

Pollning pausas när appen ligger i bakgrunden.

Servern ska om möjligt svara med förändringar efter en versionsmarkör eller tidsstämpel i stället för att skicka hela projektet.

## ADR-004: Fleranvändarstöd

Varje serverändring ska registrera användare och tidpunkt. Enskilda mätningar, foton, kommentarer och kontrollsvar sparas som separata poster för att minska risken att användare skriver över varandras arbete.

Moment kan ha:

- ansvarig användare
- flera medverkande
- status
- starttid
- senast ändrad av
- versionsnummer för optimistisk låsning

## ADR-005: Appnotiser i första versionen

Första versionen innehåller en notislista i appen. Pushnotiser och e-post är senare tillägg.

Händelser som normalt ska skapa notis för arbetsledare:

- avvikelse rapporterad
- mätvärde utanför tillåtet intervall
- moment redo för granskning
- arbetsavsnitt redo att avslutas
- användare begär beslut
- arbetsavsnitt blockerat

Vanliga fotouppladdningar och ikryssade delpunkter ska normalt inte skapa notiser.

## ADR-006: Bilder

Bilder lagras i Cloudflare R2. Metadata och koppling till projekt, arbetsområde, arbetsavsnitt, moment och fotokrav lagras i D1.

Ett fotokrav är inte uppfyllt förrän servern har bekräftat uppladdningen. I första versionen finns ingen garanterad offlinekö för bilder.
