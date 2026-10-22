// Diagnostica: struttura di status.railway.com/api/status (giorni storici omessi) e residui Instatus.
const get = async (u) => {
  const r = await fetch(u, { headers: { Origin: 'https://davedegrado.github.io' }, signal: AbortSignal.timeout(15000) });
  return { r, t: await r.text() };
};
const strip = (v) => JSON.stringify(v, (k, x) => (k === 'months' ? `[${x.length} mesi omessi]` : x), 1);
const { r, t } = await get('https://status.railway.com/api/status');
console.log('ACAO', r.headers.get('access-control-allow-origin'), 'cache', r.headers.get('cache-control'));
const j = JSON.parse(t);
console.log('chiavi top', Object.keys(j));
console.log(strip(j).slice(0, 6000));
for (const u of ['https://status.railway.com/api/incidents', 'https://status.railway.com/api/status?x=1', 'https://railway.instatus.com/v2/components.json', 'https://railway.instatus.com/v2/incidents.json', 'https://railway.instatus.com/', 'https://resend-status.com/api/v2/incidents/unresolved.json', 'https://resend-status.com/api/v2/incidents.json', 'https://status.supabase.com/api/v2/incidents/unresolved.json']) {
  try {
    const { r, t } = await get(u);
    console.log(`\n=== ${u}\nHTTP ${r.status} ${r.headers.get('content-type')} ACAO=${r.headers.get('access-control-allow-origin')} final=${r.url}\n${t.slice(0, 700).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`\n=== ${u}\nERRORE ${e.message}`); }
}
