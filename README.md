# Stato dei provider

Dashboard statica (GitHub Pages) con lo stato di Cloudflare, Supabase, Railway, Resend, Firebase, Render e GitHub.

- `providers.json`: elenco dei provider (nome, pagina ufficiale, API, tipo, se l'API ha CORS).
- `assets/providers.js`: lettura e normalizzazione in `operativo / degradato / problemi / manutenzione / sconosciuto`.
  Lo usano sia il workflow sia la pagina.
- `scripts/build-status.mjs`: interroga le API, scrive `status.json` e prepara `_site/`.
- `.github/workflows/pages.yml`: ogni 10 minuti esegue il build e pubblica con `actions/deploy-pages`, senza commit.
- `.github/workflows/probe.yml`: diagnostica manuale (HTTP, content-type, CORS di ogni API).

## Regole

- Un provider che non risponde, risponde con errore o con un formato inatteso è **sconosciuto**, mai operativo.
- La pagina legge `status.json`; per i provider con `"cors": true` rilegge le API dal browser ogni 2 minuti.
- Se `status.json` ha più di 30 minuti compare un avviso, e ogni provider con dato più vecchio di 30 minuti
  viene mostrato come sconosciuto (con l'ultimo stato noto).

## API verificate (ottobre 2026, dai runner GitHub)

| Provider   | API | Tipo | CORS |
|------------|-----|------|------|
| GitHub     | `www.githubstatus.com/api/v2/summary.json` | statuspage | sì |
| Cloudflare | `www.cloudflarestatus.com/api/v2/summary.json` | statuspage | sì |
| Render     | `status.render.com/api/v2/summary.json` | statuspage | sì |
| Supabase   | `status.supabase.com/api/v2/summary.json` | statuspage (incident.io) | sì |
| Resend     | `resend-status.com/api/v2/summary.json` (+ `incidents.json`) | statuspage (incident.io) | sì |
| Firebase   | `status.firebase.google.com/incidents.json` | google-incidents | sì |
| Railway    | `status.railway.com/api/status` | railway (pagina proprietaria) | no, solo dal workflow |

Railway non usa più Instatus: `railway.instatus.com` risponde ancora ma non è aggiornato.

## Messa in funzione

1. Settings → Pages → Source: **GitHub Actions**.
2. Il workflow pianificato gira solo sul branch predefinito: il codice deve stare su `main`
   (impostato come branch predefinito). L'ambiente `github-pages` accetta deploy solo da quel branch.
3. Avvia una volta a mano "Aggiorna stato e pubblica" da Actions.

GitHub può ritardare le esecuzioni pianificate di qualche minuto e le disattiva dopo 60 giorni senza attività
nel repository: in quel caso la pagina mostrerà l'avviso di dati vecchi.

## Sviluppo

```sh
npm test                               # test dei normalizzatori
node scripts/build-status.mjs _site    # build locale
npx serve _site                        # o qualsiasi server statico
```
