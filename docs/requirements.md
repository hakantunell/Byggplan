# Kravspecifikation för ByggPlan

## Roller

### Administratör
- Hanterar projektets struktur, användare och behörigheter.
- Lägger in och uppdaterar ritningar, tekniskt underlag, referensbilder och dokumentmallar.
- Bestämmer vilka uppgifter och bilagor som ska ingå i rapporter.
- Kan exportera samtliga rapporter och underlag.

### Arbetsledare
- Startar, tilldelar, granskar och avslutar arbetsavsnitt.
- Kan exportera rapporter och underlag.
- Kan läsa ritningar och tekniskt underlag.
- Kan vid behov komplettera tekniskt underlag och projektinformation, beroende på behörighet.

### Utförare
- Ser tilldelade och tillgängliga moment.
- Registrerar mått, kontroller, kommentarer och foton.
- Kan läsa ritningar och tekniskt underlag som hör till aktuellt moment.
- Kan inte ändra projektets styrande ritningar eller tekniska underlag.

## PDF-export och myndighetsunderlag

Arbetsledare och administratör ska kunna skapa en PDF-rapport för hela projektet, ett arbetsområde, ett arbetsavsnitt eller ett enskilt moment.

Rapporten ska kunna innehålla:
- projekt- och fastighetsuppgifter
- rapportens omfattning och datum
- arbetsområden, arbetsavsnitt och moment
- utförda kontroller och registrerade mätvärden
- enheter, referenspunkter, kravvärden och godkännandestatus
- foton med bildtext, datum, fotograf och koppling till moment eller kontrollkrav
- kommentarer, avvikelser och beslut
- vem som utfört, granskat och godkänt respektive moment
- bifogade intyg och dokument
- särskilt markerade uppgifter som kommunen, miljökontoret, kontrollansvarig eller annan myndighet efterfrågar

Rapporten ska vara tydligt strukturerad med rubriker, innehållsförteckning, sidnummer och en konsekvent layout. Administratören ska kunna definiera rapportmallar och välja vilka sektioner som ska ingå.

Systemet ska stödja minst följande rapporttyper:
- myndighetsunderlag
- dokumentation inför kontrollbesök
- arbetsavsnittsrapport
- avvikelserapport
- komplett projektpärm

En exporterad rapport ska vara en ögonblicksbild. Rapportens innehåll, skapandedatum och den användare som skapade rapporten ska sparas i systemets historik.

## Ritningar

Administratören ska kunna lägga in ritningar i projektet. Ritningar ska kunna vara PDF eller bildformat.

Varje ritning ska kunna ha:
- namn och ritningsnummer
- ritningstyp, exempelvis plan, sektion, fasad, grund, VA eller detalj
- version eller revision
- giltighetsdatum
- beskrivning
- status, exempelvis gällande, ersatt eller arkiverad
- koppling till projekt, arbetsområde, arbetsavsnitt eller moment

Användaren ska kunna:
- öppna ritningen direkt från ett moment
- zooma och panorera
- växla mellan sidor i flersidiga PDF-filer
- se vilken revision som är gällande
- öppna ritningen i fullskärmsläge på telefon

Senare versioner kan stödja markeringar och hänvisningspunkter på ritningen. En sådan markering ska kunna länkas till ett moment, mått, foto eller tekniskt underlag.

Endast administratör, eller arbetsledare med särskild behörighet, får lägga till, ersätta eller arkivera styrande ritningar. Äldre revisioner ska bevaras.

## Tekniskt underlag

Administratören ska kunna skapa tekniskt underlag som hör till projektets olika delar. Tekniskt underlag är referensdata och behöver inte vara en arbetsinstruktion.

Underlaget ska kunna innehålla:
- rubrik och beskrivande text
- bilder, skisser och detaljbilder
- mått, material, toleranser och kontrollpunkter
- hänvisningar till ritningar och dokument
- varningar och kritiska uppgifter
- länkar till tillverkarinformation
- versionsinformation och giltighetsstatus

Tekniskt underlag ska kunna kopplas till:
- projekt
- arbetsområde
- arbetsavsnitt
- moment
- kontrollpunkt
- dokumentationskrav

Exempel:
- dimensioner och armering för grundsulan
- bäddning, dimension och fall för avloppsrör
- data om timmerknutar och dymlingar
- takkonstruktionens uppbyggnad och anslutningar
- våtrummets golv, fall och tätskikt

När en användare öppnar ett moment ska relevant underlag vara tillgängligt under knappen **Visa tekniskt underlag**. Underlaget ska vara läsbart utan att användaren behöver lämna momentet.

Styrande tekniskt underlag får bara ändras av administratör, eller arbetsledare med särskild behörighet. Ändringar ska versionshanteras och äldre versioner ska bevaras.

## Datamodell som behöver stödjas

Följande huvudobjekt ska ingå i den fortsatta datamodellen:
- report_templates
- report_exports
- drawings
- drawing_revisions
- technical_documents
- technical_document_revisions
- entity_attachments
- entity_links

Filerna lagras i R2. Metadata, versioner, behörigheter och relationer lagras i D1.
