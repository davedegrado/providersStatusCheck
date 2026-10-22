// Elenca componenti, gruppi e regioni di ogni provider, per scegliere cosa monitorare in providers.json.
import { readFile } from 'node:fs/promises';

const providers = JSON.parse(await readFile('providers.json', 'utf8'));
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
        perGruppo.set(g, [...(perGruppo.get(g) ?? []), c.name]);
      }
      for (const [g, nomi] of perGruppo) console.log(`[${g}] (${nomi.length}) ${nomi.length > 40 ? nomi.slice(0, 8).join(' | ') + ' | …' : nomi.join(' | ')}`);
      // Gli incidenti recenti mostrano se l'API riporta i componenti coinvolti.
      const inc = await get(p.api.replace(/summary\.json$/, 'incidents.json'));
      for (const i of (inc.incidents ?? []).slice(0, 3)) console.log(`  incidente "${i.name}" → componenti: ${(i.components ?? []).map((c) => c.name).join(', ') || '(nessuno)'}`);
    } else if (p.type === 'railway') {
      const s = await get(p.api);
      for (const e of s.entries) console.log(e.type === 'group' ? `[${e.data.name}] ${e.data.components.map((c) => c.name).join(' | ')}` : `[-] ${e.data.name}`);
    } else if (p.type === 'google-incidents') {
      const prodotti = await get(p.statusPage.replace(/\/$/, '') + '/products.json').catch(() => null);
      console.log('prodotti:', (prodotti?.products ?? prodotti ?? []).map?.((x) => x.title ?? x).join(' | '));
      const inc = await get(p.api);
      console.log('chiavi località:', Object.keys(inc[0]).filter((k) => /location/i.test(k)));
      console.log('esempio:', JSON.stringify({ prodotti: inc[0].affected_products, loc: inc[0].currently_affected_locations ?? inc[0].previously_affected_locations }));
    }
  } catch (e) {
    console.log('ERRORE', e.message);
  }
}
