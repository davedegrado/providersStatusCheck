// Diagnostica: stato "di oggi" ricavabile da status.railway.com/api/status e confronto con Instatus.
const get = async (u) => {
  const r = await fetch(u, { headers: { Origin: 'https://davedegrado.github.io' }, signal: AbortSignal.timeout(15000) });
  return { r, t: await r.text() };
};
const { r, t } = await get('https://status.railway.com/api/status');
console.log('HTTP', r.status, 'ACAO', r.headers.get('access-control-allow-origin'), 'cache', r.headers.get('cache-control'));
const j = JSON.parse(t);
console.log('chiavi top', Object.keys(j), 'altro:', JSON.stringify(Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'entries'))).slice(0, 3000));
const comps = j.entries.flatMap((e) => (e.type === 'group' ? e.data.components : [e.data]));
console.log('componenti', comps.length, 'chiavi componente', Object.keys(comps[0]));
const day = comps[0].months.at(-1).days.at(-1);
console.log('ultimo giorno', JSON.stringify(day), 'chiavi giorno', Object.keys(day));
console.log('stati giornalieri distinti', [...new Set(comps.flatMap((c) => c.months.flatMap((m) => m.days.map((d) => d.status))))]);
for (const c of comps) {
  const d = c.months.at(-1).days.at(-1);
  if (d.status !== 'operational' || d.incidents.length) console.log('OGGI non ok:', c.name, JSON.stringify(d).slice(0, 800));
}
const sample = comps.flatMap((c) => c.months.flatMap((m) => m.days)).find((d) => d.incidents.length);
console.log('esempio incidente', JSON.stringify(sample).slice(0, 1500));

const ic = JSON.parse((await get('https://railway.instatus.com/v2/components.json')).t);
console.log('\nInstatus componenti non OPERATIONAL:', ic.components.filter((c) => c.status !== 'OPERATIONAL').map((c) => `${c.group?.name} / ${c.name}: ${c.status}`));
console.log('Instatus stati distinti', [...new Set(ic.components.map((c) => c.status))], 'n', ic.components.length);
