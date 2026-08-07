# Mappning – Vemdalens Kyrkby 44:10

Syfte: stresstesta Masterprojekt Fritidshus mot verkliga styrdokument och säkerställa att obligatoriska kontrollpunkter får en konkret plats i byggflödet.

## Status efter komplettering

Följande filer utgör nu underlaget:

- `master-projects/fritidshus-v1.json` – generell byggprocess.
- `master-projects/modules/obligatoriska-kontrollpunkter-fritidshus-v1.json` – kontrollpunkter som aktiveras när projektets styrdokument kräver dem.
- `master-projects/modules/enskilt-avlopp-v1.json` – funktionsmodul för enskilt avlopp.

Principen är att styrande krav inte skapar ett parallellt administrativt flöde. De placeras som aktiviteter exakt där kontrollen, fotot, intyget eller frigivningen måste ske i byggordningen.

## Kontrollplan enligt PBL för KA

| Kontrollpunkt | Status | Placering |
|---|---|---|
| Utstakning av byggnaden | TÄCKT | 10.10 Starta byggarbetsplatsen |
| Lägeskontroll / kontrollmätning | TÄCKT | Compliance-modul → 20.10 Förbered markarbete |
| KA-besök vid grundbotten före gjutning | TÄCKT | Compliance-modul → 20.40 före gjutning |
| KA-besök när stommen är rest | TÄCKT | Compliance-modul → 30 Bärande stomme |
| KA-besök under invändiga arbeten | TÄCKT | Compliance-modul → 70 Invändiga konstruktioner |
| Byggnadsnämndens arbetsplatsbesök innan igenbyggnad | TÄCKT | Compliance-modul → 60.50 Samordning före igenbyggnad |
| Slutsamråd | TÄCKT | 120.20 Slutbesked |
| Kontroll mot bygglov / byggherreintyg | TÄCKT | Compliance-modul → 120.10 Slutdokumentation |
| Arbetsmiljöplan | TÄCKT | 10.10 Startförutsättningar |
| BAS-P | TÄCKT | Compliance-modul → 10.10 |
| BAS-U | TÄCKT | Compliance-modul → 10.10 |
| Startmöte BH + KA | TÄCKT | Compliance-modul → 10.10 |
| Geoteknisk utredning | ADMIN/STYRDOKUMENT | Ska finnas som styrande underlag; utförs normalt före ByggPlans scope. |
| Radonklass | ADMIN/STYRDOKUMENT | Projekteringsunderlag. |
| Bärförmåga och stadga | TÄCKT VIA FLERA AKTIVITETER | Grund, stomme och tak innehåller kontroller och dokumentation. |
| Intyg sotare / rökkanal / taksäkerhet | TÄCKT | 60.40 Eldstad och rökkanal |
| Brandskyddsbeskrivning | ADMIN/STYRDOKUMENT | Projekteringsunderlag. |
| Slutlig brandskyddsdokumentation | TÄCKT | Compliance-modul → 120.10 |
| Dagvatteninstallation | TÄCKT | 100.10 Dagvatten och mark |
| Våtrumsbehörighet eller dokumenterad metod | TÄCKT | Compliance-modul → 80.10 |
| Fuktsäkerhetsprojektering | ADMIN/STYRDOKUMENT | Projekteringsunderlag; utförandet verifieras i byggprocessen. |
| Provtryckningsprotokoll VA | TÄCKT | 60.10 + 110.10 |
| Registrerat elinstallationsföretag | TÄCKT | Compliance-modul → 60.20 före elarbete |
| Isolationsprovning | TÄCKT | Compliance-modul → 110.10 |
| Jordfelsbrytare | TÄCKT | Compliance-modul → 110.10 |
| Arkitektens egenkontroll / ändamålsenlighet | ADMIN/STYRDOKUMENT | Projekterings-/slutdokument. |
| Tillgänglighet och användbarhet | ADMIN/STYRDOKUMENT | Projekterings-/slutdokument. |
| VA-inspektion före övertäckning | TÄCKT | Compliance-modul → 100.20 före återfyllnad |
| Relationshandling LOD + VA | TÄCKT | Compliance-modul → 120.10 |
| Förberedelse bredband | PROJEKTSPECIFIK | Läggs som valbar aktivitet/modul när projektet kräver det. |
| Laddning av elfordon – ej aktuell | UNDANTAG | Markeras Ej tillämplig (N/A). |

## Miljöbeslut – enskilt avlopp

Samtliga identifierade utförande- och dokumentationskrav har nu en konkret aktivitet i `enskilt-avlopp-v1.json`.

| Villkor / dokumentationskrav | Status | Placering |
|---|---|---|
| Följ tillstånd, situationsplan och monteringsanvisningar | TÄCKT | 100.21 Förberedelser |
| Dokumenterat sakkunnig utförare | TÄCKT | 100.21 Registrera ansvarig entreprenör |
| Tät anläggning fram till infiltration | TÄCKT | 100.22 Täthetskontroll före återfyllnad |
| Förbjudna vattenflöden får inte anslutas | TÄCKT | 100.22 Kontroll före återfyllnad |
| Foto i varje installerad brunn | TÄCKT | 100.22 före återfyllnad |
| Foto ledningar före igenläggning | TÄCKT | 100.22 före återfyllnad |
| VA-inspektion före övertäckning | TÄCKT | 100.22 frigivningspunkt |
| Foto tom grop för infiltration/markbädd | TÄCKT NÄR MODULDELEN ANVÄNDS | 100.23 |
| Foto varje lager | TÄCKT NÄR MODULDELEN ANVÄNDS | 100.23 |
| Översiktsbild hus + brunn + infiltration/anslutning | TÄCKT | 100.24 |
| Slamtömningsåtkomlighet | TÄCKT | 100.21 före installation/färdig mark |
| Entreprenörsrapport och foton till kommunen | TÄCKT | 100.24 slutrapportering |
| Tillstånd och slutunderlag sparas med fastigheten | TÄCKT | 100.24 + styrdokumentarkiv |

## Återstående arbete

Strukturen har nu aktiviteter för de identifierade kraven. Nästa steg är inte att lägga till fler generella aktiviteter på spekulation, utan att:

1. Importera Masterprojektets struktur till ett testprojekt.
2. Aktivera relevanta compliance-aktiviteter och modulen Enskilt avlopp.
3. Importera kontrollplan och miljöbeslut som styrande dokument.
4. Mappa varje styrande post mot en eller flera aktiviteter.
5. Köra Kartläggning/coverage och endast komplettera projektstrukturen där verkliga poster fortfarande är röda eller delvis täckta.

Målet är 100 % omhändertagna styrande poster utan att göra aktivitetsflödet onödigt tungt.
