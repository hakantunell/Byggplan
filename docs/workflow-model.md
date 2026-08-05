# Arbetsflödesmodell

## Hierarki

```text
Projekt
└── Arbetsområde
    └── Arbetsavsnitt
        └── Moment
            ├── Beroenden
            ├── Kontrollpunkter
            ├── Dokumentationskrav
            ├── Mätvärden
            ├── Foton
            ├── Kommentarer
            └── Avvikelser
```

## Arbetsavsnitt

Flera arbetsavsnitt får vara aktiva samtidigt. Exempel:

- husgrund
- trekammarbrunn
- vattenledning
- elservis
- parkeringsyta

Status:

- `not_started`
- `in_progress`
- `waiting`
- `ready_for_review`
- `completed`

Ett arbetsavsnitt får inte få status `completed` förrän samtliga obligatoriska krav är uppfyllda.

## Moment

Status:

- `todo`
- `in_progress`
- `blocked`
- `ready_for_review`
- `completed`
- `not_applicable`

`not_applicable` kräver kommentar och användaridentitet.

Användare får öppna och läsa blockerade och kommande moment. De får däremot inte markera dem klara innan beroendena är uppfyllda.

## Kravtyper

Ett moment kan innehålla följande krav:

- checkruta
- ja/nej
- kort text
- lång text
- heltal eller decimaltal
- mätvärde med enhet
- datum eller tid
- ett val
- flera val
- foto
- dokument
- person
- plats eller referenspunkt
- godkännande

Varje krav kan vara obligatoriskt eller rekommenderat.

## Mätvärden

Ett mätvärde ska kunna innehålla:

- benämning
- numeriskt värde
- enhet
- mätmetod
- referenspunkt
- minsta och högsta tillåtna värde
- tolerans
- kommentar
- användare och tidpunkt
- kopplade foton
- resultat: godkänt, underkänt eller kräver bedömning

Exempel:

```json
{
  "label": "Förläggningsdjup vid huset",
  "unit": "mm",
  "required": true,
  "minimum": 800,
  "reference": "Från färdig marknivå till rörets hjässa",
  "requirePhoto": true
}
```

## Frigivningspunkter

Ett moment som döljs av efterföljande arbete, exempelvis återfyllning eller gjutning, ska kunna föregås av en frigivningspunkt.

Flöde:

```text
Utför arbete
→ Kontrollera
→ Dokumentera
→ Hantera eventuella avvikelser
→ Godkänn frigivningspunkt
→ Nästa moment blir tillgängligt
```

## Avslutskontroll

När användaren försöker avsluta ett moment eller arbetsavsnitt ska appen lista exakt vad som saknas, exempelvis:

- två obligatoriska kontrollpunkter är inte besvarade
- foto av röranslutningen saknas
- förläggningsdjupet är utanför gränsvärdet
- en avvikelse är fortfarande öppen
- arbetsledarens godkännande saknas

Avslutsknappen ska vara synlig men inaktiv när krav saknas.

## Samtidigt arbete

Ett moment kan ha en ansvarig och flera medverkande. När en användare tar ansvar visas detta för övriga efter nästa uppdatering.

Registreringar ska i första hand läggas till som separata poster. Befintliga poster som redigeras ska använda versionsnummer för optimistisk låsning.

## Projektets nästa-arbete-vy

Startsidan ska gruppera tillgängligt arbete i:

1. Måste göras nu – blockerar fortsatt arbete eller riskerar att döljas.
2. Kan göras nu – har inga ouppfyllda beroenden.
3. Väntar – på material, person, beslut eller annat moment.
4. Kommande – synligt för planering men ännu inte tillgängligt.
5. Kräver uppmärksamhet – avvikelser, granskningar och beslut.
