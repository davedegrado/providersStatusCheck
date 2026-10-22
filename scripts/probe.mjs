// Diagnostica: per ogni API in providers.json stampa HTTP, content-type, header CORS e un estratto del corpo.
// Uso: node scripts/probe.mjs [url ...]   (senza argomenti usa le API di providers.json)
import { readFile } from 'node:fs/promises';

const ORIGIN = 'https://davedegrado.github.io';
const urls = process.argv.length > 2
  ? process.argv.slice(2)
  : JSON.parse(await readFile('providers.json', 'utf8')).map((p) => p.api);

for (const url of urls) {
  console.log(`\n=== ${url}`);
  try {
    const res = await fetch(url, {
      headers: { Origin: ORIGIN, 'User-Agent': 'providers-status-probe' },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    console.log(`HTTP ${res.status}  final=${res.url}`);
    console.log(`content-type: ${res.headers.get('content-type')}`);
    console.log(`access-control-allow-origin: ${res.headers.get('access-control-allow-origin')}`);
    console.log(body.slice(0, 400).replace(/\s+/g, ' '));
    // Per le API Statuspage: indicatore complessivo e componenti non operativi, raggruppati per stato.
    try {
      const j = JSON.parse(body);
      if (j.status?.indicator && Array.isArray(j.components)) {
        const gruppi = new Map(j.components.filter((c) => c.group).map((c) => [c.id, c.name]));
        const nonOk = j.components.filter((c) => !c.group && c.status !== 'operational');
        console.log(`indicatore: ${j.status.indicator} (${j.status.description}); componenti non operativi: ${nonOk.length}/${j.components.filter((c) => !c.group).length}`);
        for (const c of nonOk) console.log(`  - ${c.status}: ${gruppi.get(c.group_id) ?? '-'} / ${c.name}`);
      }
    } catch { /* non JSON */ }
  } catch (e) {
    console.log(`ERRORE: ${e.name}: ${e.message}${e.cause ? ` / ${e.cause.message}` : ''}`);
  }
}
