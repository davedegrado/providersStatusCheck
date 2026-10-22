// Elenca componenti, gruppi e regioni di ogni provider, per scegliere cosa monitorare in providers.json.
// Uso: node scripts/componenti.mjs [id-provider ...]
import { readFile } from 'node:fs/promises';

const solo = process.argv.slice(2);
const providers = JSON.parse(await readFile('providers.json', 'utf8')).filter((p) => !solo.length || solo.includes(p.id));
const get = async (u) => (await fetch(u, { signal: AbortSignal.timeout(15000) })).json();

for (const p of providers) {
  console.log(`\n##### ${p.name} (${p.type})`);
  try {
    if (p.type === 'statuspage') {
      const s = await get(p.api.replace(/summary\.json$/, 'components.json'));
      const gruppi = new Map(s.components.filter((c) => c.group).map((c) => [c.id, c.name]));
      const perGruppo = new Map();
      for (const c of s.components.filter((c) => !c.group)) {
        const g = gruppi.get(c.group_id) ?? '(senza gruppo)';
        perGruppo.set(g, [...(perGruppo.get(g) ?? []), `${c.name}${c.status === 'operational' ? '' : ` [${c.status}]`}`]);
      }
      for (const [g, nomi] of perGruppo) console.log(`[${g}] (${nomi.length})\n  ${nomi.join(' | ')}`);
      const inc = await get(p.api.replace(/summary\.json$/, 'incidents.json'));
      for (const i of (inc.incidents ?? []).slice(0, 10)) console.log(`  incidente "${i.name}" → componenti: ${(i.components ?? []).map((c) => c.name).join(', ') || '(nessuno)'}`);
    } else if (p.type === 'railway') {
      const s = await get(p.api);
      for (const e of s.entries) console.log(e.type === 'group' ? `[${e.data.name}] ${e.data.components.map((c) => c.name).join(' | ')}` : `[-] ${e.data.name}`);
      for (const i of [...(s.activeIncidents ?? []), ...(s.recentIncidents ?? [])].slice(0, 10)) {
        console.log(`  incidente "${i.title}" → ${(i.components ?? []).map((c) => `${c.groupName} / ${c.name}: ${c.impact}`).join(', ') || '(nessuno)'}`);
      }
    } else if (p.type === 'google-incidents') {
      const inc = await get(p.api);
      console.log('prodotti negli incidenti:', [...new Set(inc.flatMap((i) => (i.affected_products ?? []).map((x) => x.title)))].join(' | '));
    }
  } catch (e) {
    console.log('ERRORE', e.message);
  }
}
