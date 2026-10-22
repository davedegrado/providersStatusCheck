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

## Servizi che uso

Ogni provider in `providers.json` può avere un `filtro`: lo stato dipende solo dai componenti indicati,
gli altri problemi restano visibili ma chiusi sotto "non ti riguarda". Le voci sono espressioni regolari
confrontate con "Gruppo / Componente" (l'elenco dei nomi si ottiene con `node scripts/componenti.mjs`, o lanciando
il workflow "Diagnostica API di stato").

| Campo | Significato |
|---|---|
| `componenti` | servizi da cui dipendono le app: decidono lo stato |
| `secondari` | build, deploy, dashboard: toccano il tuo lavoro, non gli utenti; al massimo "degradato" |
| `soloIncidenti` | contano solo se citati in un incidente (es. datacenter europei di Cloudflare), come "secondari" |
| `ignora` | per incidenti senza componenti (Supabase, Resend): titoli su funzioni che non usi |
| `altrove` / `qui` | titoli su altre regioni non contano, a meno che citino anche la tua |

Nel dubbio un incidente conta. Configurazione attuale:

- **Cloudflare**: DNS, CDN, certificati SSL, Workers (+ Assets, KV), Pages, Email Routing; secondari Registrar,
  aggiornamenti DNS, Workers Builds, dashboard, API; datacenter europei solo informativi.
- **Supabase**: eu-central-1 e Auth; ignorati Management API, ciclo di vita dei progetti, Edge Functions, Realtime, log.
- **Railway**: Compute, Storage e rete in tutte le regioni; build, deploy e dashboard secondari.
- **Resend**: invio (singolo e batch), API, webhook ed eventi (ricezione); ignorati broadcast e automazioni.
- **Firebase**: Cloud Messaging.
- **GitHub**: Git, Actions, Pages, Webhooks, API, tutti secondari (non toccano gli utenti delle app).
- **Render**: nessun filtro.

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
