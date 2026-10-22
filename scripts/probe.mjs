// Diagnostica: interroga gli URL candidati e stampa HTTP, content-type, CORS e un estratto del corpo.
const ORIGIN = 'https://davedegrado.github.io';
const urls = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://www.githubstatus.com/api/v2/summary.json',
  'https://www.cloudflarestatus.com/api/v2/summary.json',
  'https://status.supabase.com/api/v2/summary.json',
  'https://status.render.com/api/v2/summary.json',
  'https://status.railway.com/summary.json',
  'https://status.railway.com/api/v2/summary.json',
  'https://status.railway.com/',
  'https://status.firebase.google.com/incidents.json',
  'https://resend-status.com/',
  'https://resend-status.com/api/v2/summary.json',
  'https://resend-status.com/summary.json',
  'https://resend-status.com/index.json',
  'https://resend-status.com/feed.rss',
];

for (const url of urls) {
  console.log(`\n=== ${url}`);
  try {
    const res = await fetch(url, {
      headers: { Origin: ORIGIN, 'User-Agent': 'providers-status-probe' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    console.log(`HTTP ${res.status}  final=${res.url}`);
    console.log(`content-type: ${res.headers.get('content-type')}`);
    console.log(`access-control-allow-origin: ${res.headers.get('access-control-allow-origin')}`);
    console.log(`server: ${res.headers.get('server')}  size=${body.length}`);
    const gen = body.match(/(statuspage|instatus|betteruptime|better stack|openstatus|atlassian|incident\.io|status\.io)/i);
    if (gen) console.log(`platform hint: ${gen[0]}`);
    console.log(body.slice(0, 600).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`ERRORE: ${e.name}: ${e.message}${e.cause ? ' / ' + e.cause.message : ''}`);
  }
}
