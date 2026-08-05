# ByggPlan – första körbara versionen

En mobilanpassad prototyp för att styra och dokumentera ett självbygge.

## Funktioner i prototypen

- startsida med nästa viktiga moment
- parallella arbetsavsnitt
- status: kan göras, pågår, blockerad och redo för kontroll
- obligatoriska foton, kontrollpunkter och mätvärden
- onlinekrav för alla registreringar
- automatisk uppdatering var 60:e sekund när appen är aktiv
- spärr mot att skicka moment för kontroll innan alla obligatoriska uppgifter är klara
- responsiv vy för mobil och dator

## Kör lokalt

Ingen installation eller byggprocess krävs.

```bash
cd prototype
python3 -m http.server 8080
```

Öppna sedan `http://localhost:8080`.

## Viktigt

Denna version använder exempeldata i webbläsaren. Nästa steg är att ansluta Cloudflare Workers, D1 och R2 så att användare, status, mått och bilder persisteras centralt.
