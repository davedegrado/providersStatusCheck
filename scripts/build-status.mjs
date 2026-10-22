// Legge tutte le API di stato, scrive status.json e prepara la cartella del sito per GitHub Pages.
// Uso: node scripts/build-status.mjs [cartella-di-output]   (predefinita: _site)
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { controlla, creaFetchJson } from '../assets/providers.js';

const out = process.argv[2] ?? '_site';
const providers = JSON.parse(await readFile('providers.json', 'utf8'));
const fetchJson = creaFetchJson({ 'User-Agent': 'providers-status-check (+https://github.com/davedegrado/providersStatusCheck)' });

const risultati = await Promise.all(providers.map((p) => controlla(p, fetchJson)));
const stato = { generato: new Date().toISOString(), provider: risultati };

await mkdir(out, { recursive: true });
await Promise.all([
  cp('index.html', `${out}/index.html`),
  cp('assets', `${out}/assets`, { recursive: true }),
  cp('providers.json', `${out}/providers.json`),
  writeFile(`${out}/status.json`, JSON.stringify(stato, null, 2)),
]);

for (const r of risultati) {
  console.log(`${r.nome.padEnd(12)} ${r.stato.padEnd(12)} ${r.errore ? `ERRORE: ${r.errore}` : r.descrizione ?? ''}`);
  for (const i of r.incidenti) console.log(`${''.padEnd(25)}- ${i.titolo} (${i.stato})`);
}
