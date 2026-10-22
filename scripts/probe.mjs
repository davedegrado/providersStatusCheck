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
  } catch (e) {
    console.log(`ERRORE: ${e.name}: ${e.message}${e.cause ? ` / ${e.cause.message}` : ''}`);
  }
}
