// Diagnostica approfondita: Railway (piattaforma sconosciuta) e struttura incidenti Firebase.
const get = async (u) => {
  const r = await fetch(u, { headers: { Origin: 'https://davedegrado.github.io' }, signal: AbortSignal.timeout(15000) });
  return { r, t: await r.text() };
};

console.log('### Railway homepage: riferimenti a script, API e JSON');
const { t: html } = await get('https://status.railway.com/');
const refs = new Set(html.match(/(?:src|href)="[^"]+"|https?:\/\/[^"'\s<>)]+|\/api\/[^"'\s<>)]+|["'][^"']*\.json[^"']*["']/g) || []);
for (const x of refs) console.log('  ', x);
console.log('--- script inline (primi 3000 char) ---');
for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) console.log(m[1].slice(0, 3000));

for (const u of [
  'https://status.railway.com/feed.rss', 'https://status.railway.com/history.rss',
  'https://status.railway.com/api/status', 'https://status.railway.com/api/summary',
  'https://status.railway.com/status.json', 'https://status.railway.com/api/v1/status',
  'https://railway.instatus.com/summary.json', 'https://railway.betteruptime.com/',
]) {
  try {
    const { r, t } = await get(u);
    console.log(`\n=== ${u}\nHTTP ${r.status} ${r.headers.get('content-type')} ACAO=${r.headers.get('access-control-allow-origin')} final=${r.url}\n${t.slice(0, 400).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`\n=== ${u}\nERRORE ${e.message}`); }
}

console.log('\n### Firebase incidents.json');
const inc = JSON.parse((await get('https://status.firebase.google.com/incidents.json')).t);
console.log('totale', inc.length, 'chiavi', Object.keys(inc[0]));
const open = inc.filter((i) => !i.end);
console.log('senza end (in corso):', open.length);
for (const i of inc.slice(0, 3)) console.log(JSON.stringify({ ...i, updates: undefined, affected_products: i.affected_products, currently_affected_locations: undefined, previously_affected_locations: undefined }));
console.log('valori severity', [...new Set(inc.map((i) => i.severity))], 'status_impact', [...new Set(inc.map((i) => i.status_impact))], 'mru.status', [...new Set(inc.map((i) => i.most_recent_update?.status))]);

console.log('\n### Status/indicator e chiavi dei summary Statuspage-compatibili');
for (const u of ['https://www.githubstatus.com/api/v2/summary.json', 'https://www.cloudflarestatus.com/api/v2/summary.json', 'https://status.supabase.com/api/v2/summary.json', 'https://status.render.com/api/v2/summary.json', 'https://resend-status.com/api/v2/summary.json']) {
  const j = JSON.parse((await get(u)).t);
  console.log(u, Object.keys(j), JSON.stringify(j.status), 'incidents', j.incidents?.map((i) => `${i.status}/${i.impact}: ${i.name}`), 'maint', j.scheduled_maintenances?.map((m) => `${m.status}: ${m.name}`));
}
