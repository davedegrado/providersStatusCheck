// Pagina: legge status.json (scritto dal workflow) e, per i provider con CORS, aggiorna dal vivo dal browser.
import { STATI, controlla, creaFetchJson } from './providers.js';

const VECCHIO_MS = 30 * 60 * 1000;
const INTERVALLO_LIVE_MS = 2 * 60 * 1000;
const INTERVALLO_SNAPSHOT_MS = 5 * 60 * 1000;

const ETICHETTE = {
  operativo: 'Operativo',
  degradato: 'Degradato',
  problemi: 'Problemi',
  manutenzione: 'Manutenzione',
  sconosciuto: 'Sconosciuto',
};

const CONTEGGI = {
  problemi: ['con problemi', 'con problemi'],
  degradato: ['degradato', 'degradati'],
  manutenzione: ['in manutenzione', 'in manutenzione'],
  sconosciuto: ['sconosciuto', 'sconosciuti'],
};

const $ = (id) => document.getElementById(id);
const fetchJson = creaFetchJson();

let providers = [];
let snapshot = null;
let erroreSnapshot = null;
const live = new Map();

// --- Tema -------------------------------------------------------------------

function leggiTema() {
  try { return localStorage.getItem('tema'); } catch { return null; }
}

function applicaTema(tema) {
  if (tema === 'light' || tema === 'dark') document.documentElement.dataset.theme = tema;
  else delete document.documentElement.dataset.theme;
}

function temaEffettivo() {
  const forzato = document.documentElement.dataset.theme;
  if (forzato) return forzato;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

applicaTema(leggiTema());
$('tema').addEventListener('click', () => {
  const nuovo = temaEffettivo() === 'dark' ? 'light' : 'dark';
  applicaTema(nuovo);
  try { localStorage.setItem('tema', nuovo); } catch { /* preferenza non salvata */ }
});

// --- Dati -------------------------------------------------------------------

async function caricaJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function caricaSnapshot() {
  try {
    snapshot = await caricaJson('status.json');
    erroreSnapshot = null;
  } catch (e) {
    erroreSnapshot = e.message;
  }
}

async function aggiornaLive() {
  await Promise.all(providers.filter((p) => p.cors).map(async (p) => {
    live.set(p.id, await controlla(p, fetchJson));
  }));
}

// Sceglie il dato più recente e affidabile per ogni provider.
// Un dato più vecchio di 30 minuti non viene mostrato come valido: lo stato diventa "sconosciuto".
function voci() {
  const daSnapshot = new Map((snapshot?.provider ?? []).map((r) => [r.id, r]));
  const elenco = providers.length ? providers : (snapshot?.provider ?? []).map((r) => ({ id: r.id, name: r.nome, statusPage: r.paginaUfficiale }));
  const adesso = Date.now();

  return elenco.map((p) => {
    const diretto = live.get(p.id);
    const auto = daSnapshot.get(p.id);
    let r;
    if (diretto && !diretto.errore) r = { ...diretto, fonte: 'browser' };
    else if (auto) r = { ...auto, fonte: 'workflow' };
    else if (diretto) r = { ...diretto, fonte: 'browser' };
    else {
      r = {
        id: p.id, nome: p.name, paginaUfficiale: p.statusPage, stato: 'sconosciuto',
        descrizione: 'Nessun dato disponibile', incidenti: [], controllato: null, fonte: null,
      };
    }

    const eta = r.controllato ? adesso - Date.parse(r.controllato) : Infinity;
    if (r.controllato && eta > VECCHIO_MS) {
      r = { ...r, vecchio: true, statoPrecedente: r.stato, stato: 'sconosciuto' };
    }
    return r;
  }).sort((a, b) => STATI.indexOf(a.stato) - STATI.indexOf(b.stato) || a.nome.localeCompare(b.nome, 'it'));
}

// --- Formattazione ----------------------------------------------------------

const formatoOra = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const formatoData = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function quando(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const minuti = Math.round((Date.now() - t) / 60000);
  const oggi = new Date(t).toDateString() === new Date().toDateString();
  const assoluto = oggi ? `alle ${formatoOra.format(t)}` : `il ${formatoData.format(t)}`;
  if (minuti < 1) return `${assoluto} (adesso)`;
  if (minuti < 60) return `${assoluto} (${minuti} min fa)`;
  if (minuti < 48 * 60) return `${assoluto} (${Math.round(minuti / 60)} h fa)`;
  return assoluto;
}

function minutiFa(iso) {
  return Math.round((Date.now() - Date.parse(iso)) / 60000);
}

const urlSicuro = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

function el(tag, attributi = {}, ...figli) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (v == null) continue;
    if (k === 'class') nodo.className = v;
    else if (k.startsWith('data-')) nodo.setAttribute(k, v);
    else nodo[k] = v;
  }
  for (const f of figli) if (f != null && f !== '') nodo.append(f);
  return nodo;
}

// --- Rendering --------------------------------------------------------------

function disegnaRiepilogo(elenco) {
  const box = $('riepilogo');
  const nonOk = elenco.filter((r) => r.stato !== 'operativo');
  if (!elenco.length) return;

  if (!nonOk.length) {
    box.dataset.stato = 'operativo';
    box.querySelector('.riepilogo-titolo').textContent = 'Tutto operativo';
    box.querySelector('.riepilogo-dettaglio').textContent = `${elenco.length} provider senza problemi segnalati.`;
    return;
  }

  box.dataset.stato = nonOk[0].stato;
  box.querySelector('.riepilogo-titolo').textContent = nonOk.length === 1
    ? `1 provider su ${elenco.length} non è operativo`
    : `${nonOk.length} provider su ${elenco.length} non sono operativi`;
  const conteggi = STATI.filter((s) => s !== 'operativo')
    .map((s) => [s, nonOk.filter((r) => r.stato === s).length])
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${CONTEGGI[s][n === 1 ? 0 : 1]}`);
  box.querySelector('.riepilogo-dettaglio').textContent = `${conteggi.join(' · ')}: ${nonOk.map((r) => r.nome).join(', ')}.`;
}

function disegnaAvviso() {
  const avviso = $('avviso');
  let testo = '';
  if (!snapshot) {
    testo = `Impossibile leggere status.json${erroreSnapshot ? ` (${erroreSnapshot})` : ''}: sono mostrati solo i provider che il browser riesce a leggere direttamente.`;
  } else {
    const eta = Date.now() - Date.parse(snapshot.generato);
    if (eta > VECCHIO_MS) {
      testo = `I dati del controllo automatico sono vecchi: l'ultimo è ${quando(snapshot.generato)}. `
        + 'Il workflow potrebbe essere fermo. I provider letti direttamente dal browser restano aggiornati; gli altri sono indicati come sconosciuti.';
    }
  }
  avviso.textContent = testo;
  avviso.hidden = !testo;
}

function disegnaScheda(r) {
  const descrizione = r.errore
    ? `Nessuna risposta valida dalla pagina di stato (${r.errore}).`
    : r.descrizione;

  const disegnaIncidente = (i) => {
    const url = urlSicuro(i.url);
    const titolo = url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, i.titolo || 'Incidente') : el('strong', {}, i.titolo || 'Incidente');
    const meta = [
      i.tipo === 'manutenzione' ? 'Manutenzione' : null,
      i.servizio,
      i.coinvolti?.length ? `riguarda ${i.coinvolti.slice(0, 3).join(', ')}` : null,
      i.stato ? String(i.stato).toLowerCase().replaceAll('_', ' ') : null,
      i.aggiornato ? `aggiornato ${quando(i.aggiornato)}` : null,
    ].filter(Boolean).join(' · ');
    return el('li', { class: 'incidente', 'data-stato': i.gravita ?? null }, titolo, el('span', { class: 'incidente-meta' }, meta));
  };
  // Dati vecchi senza il campo "rilevante" valgono come rilevanti.
  const tutti = r.incidenti ?? [];
  const propri = tutti.filter((i) => i.rilevante !== false).map(disegnaIncidente);
  const altri = tutti.filter((i) => i.rilevante === false).map(disegnaIncidente);
  const incidenti = propri;
  const altriBlocco = altri.length
    ? el('details', { class: 'altri' },
      el('summary', {}, altri.length === 1 ? '1 problema che non ti riguarda' : `${altri.length} problemi che non ti riguardano`),
      el('ul', { class: 'incidenti' }, ...altri))
    : null;
  const note = (r.note ?? []).map((n) => el('li', {}, n));

  const fonte = r.fonte === 'browser' ? 'letto dal browser' : r.fonte === 'workflow' ? 'controllo automatico' : null;
  const controllo = r.controllato
    ? `Controllato ${quando(r.controllato)}${fonte ? ` · ${fonte}` : ''}`
    : 'Mai controllato';
  const vecchio = r.vecchio
    ? el('span', { class: 'vecchio' }, `Dato vecchio di ${minutiFa(r.controllato)} min (ultimo stato: ${ETICHETTE[r.statoPrecedente]?.toLowerCase() ?? r.statoPrecedente})`)
    : null;
  const pagina = urlSicuro(r.paginaUfficiale);

  return el('li', { class: 'scheda', 'data-stato': r.stato },
    el('div', { class: 'scheda-testa' },
      el('h2', {}, r.nome),
      el('span', { class: 'badge' }, ETICHETTE[r.stato] ?? r.stato)),
    descrizione ? el('p', { class: 'descrizione' }, descrizione) : null,
    incidenti.length ? el('ul', { class: 'incidenti' }, ...incidenti) : null,
    note.length ? el('ul', { class: 'note' }, ...note) : null,
    altriBlocco,
    el('div', { class: 'scheda-piede' },
      el('span', {}, controllo, vecchio ? el('br') : null, vecchio),
      pagina ? el('a', { href: pagina, target: '_blank', rel: 'noopener' }, 'Pagina ufficiale ↗') : null));
}

function disegna() {
  const elenco = voci();
  disegnaRiepilogo(elenco);
  disegnaAvviso();
  $('lista').replaceChildren(...elenco.map(disegnaScheda));
  $('generato').textContent = snapshot ? `Ultimo controllo automatico ${quando(snapshot.generato)}.` : '';
  const problemi = elenco.filter((r) => r.stato !== 'operativo').length;
  document.title = problemi ? `(${problemi}) Stato dei provider` : 'Stato dei provider';
}

// --- Avvio ------------------------------------------------------------------

async function avvia() {
  const [elencoProvider] = await Promise.allSettled([caricaJson('providers.json'), caricaSnapshot()]);
  if (elencoProvider.status === 'fulfilled') providers = elencoProvider.value;
  disegna();

  await aggiornaLive();
  disegna();

  setInterval(async () => { await aggiornaLive(); disegna(); }, INTERVALLO_LIVE_MS);
  setInterval(async () => { await caricaSnapshot(); disegna(); }, INTERVALLO_SNAPSHOT_MS);
  setInterval(disegna, 30 * 1000);
}

avvia();
