// Lettura e normalizzazione dello stato dei provider.
// Modulo condiviso: lo usa il workflow (Node) per scrivere status.json e la pagina per l'aggiornamento dal vivo.

export const STATI = ['problemi', 'degradato', 'manutenzione', 'sconosciuto', 'operativo'];

const TIMEOUT_MS = 15000;

// Restituisce una funzione che scarica un URL e ne fa il parse JSON, con timeout.
// Alcune pagine rispondono 200 con HTML agli URL sconosciuti: in quel caso il parse fallisce e si segnala errore.
export function creaFetchJson(headers = {}) {
  return async function fetchJson(url) {
    const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const testo = await res.text();
    try {
      return JSON.parse(testo);
    } catch {
      throw new Error('risposta non JSON');
    }
  };
}

const togliSlash = (url) => url.replace(/\/+$/, '');
const inCorso = (n) => (n === 1 ? '1 incidente in corso' : `${n} incidenti in corso`);

// Statuspage di Atlassian e pagine compatibili (incident.io).
const INDICATORI = { none: 'operativo', minor: 'degradato', major: 'problemi', critical: 'problemi', maintenance: 'manutenzione' };
const INCIDENTE_CHIUSO = new Set(['resolved', 'postmortem', 'completed']);
const MANUTENZIONE_IN_CORSO = new Set(['in_progress', 'verifying']);

async function statuspage(p, fetchJson) {
  const s = await fetchJson(p.api);
  const indicatore = s?.status?.indicator;
  if (!indicatore) throw new Error('risposta senza status.indicator');

  let incidenti = s.incidents;
  if (!Array.isArray(incidenti)) {
    // incident.io può omettere gli incidenti dal summary: li prende da incidents.json, se c'è.
    try {
      incidenti = (await fetchJson(p.api.replace(/summary\.json$/, 'incidents.json'))).incidents ?? [];
    } catch {
      incidenti = [];
    }
  }
  const attivi = incidenti.filter((i) => !INCIDENTE_CHIUSO.has(i.status));
  const manutenzioni = (s.scheduled_maintenances ?? []).filter((m) => MANUTENZIONE_IN_CORSO.has(m.status));

  let stato = INDICATORI[indicatore] ?? 'sconosciuto';
  if (stato === 'operativo' && attivi.length) stato = 'degradato';
  if (stato === 'operativo' && manutenzioni.length) stato = 'manutenzione';

  const base = togliSlash(p.statusPage);
  const voce = (i, tipo) => ({
    titolo: i.name,
    stato: i.status,
    impatto: i.impact,
    tipo,
    url: i.shortlink || `${base}/incidents/${i.id}`,
    aggiornato: i.updated_at ?? i.created_at,
  });
  return {
    stato,
    descrizione: s.status.description,
    incidenti: [...attivi.map((i) => voce(i, 'incidente')), ...manutenzioni.map((m) => voce(m, 'manutenzione'))],
  };
}

// Instatus (/summary.json). Nessun provider attuale lo usa, resta per compatibilità.
const STATI_INSTATUS = { UP: 'operativo', HASISSUES: 'degradato', UNDERMAINTENANCE: 'manutenzione' };

async function instatus(p, fetchJson) {
  const s = await fetchJson(p.api);
  const pagina = s?.page?.status;
  if (!pagina) throw new Error('risposta senza page.status');
  const attivi = s.activeIncidents ?? [];
  const manutenzioni = s.activeMaintenances ?? [];
  let stato = STATI_INSTATUS[pagina] ?? 'sconosciuto';
  if (attivi.some((i) => /MAJOROUTAGE|PARTIALOUTAGE/.test(i.impact ?? ''))) stato = 'problemi';
  const voce = (i, tipo) => ({
    titolo: i.name,
    stato: i.status,
    impatto: i.impact,
    tipo,
    url: i.url || p.statusPage,
    aggiornato: i.updatedAt ?? i.started ?? i.start,
  });
  return {
    stato,
    descrizione: null,
    incidenti: [...attivi.map((i) => voce(i, 'incidente')), ...manutenzioni.map((m) => voce(m, 'manutenzione'))],
  };
}

// Google Cloud / Firebase: array di incidenti, quelli senza "end" sono in corso.
const IMPATTI_GOOGLE = { SERVICE_OUTAGE: 'problemi', SERVICE_DISRUPTION: 'degradato', SERVICE_INFORMATION: 'degradato' };

async function googleIncidents(p, fetchJson) {
  const lista = await fetchJson(p.api);
  if (!Array.isArray(lista)) throw new Error('risposta non è un elenco di incidenti');
  const attivi = lista.filter((i) => !i.end);
  const stati = attivi.map((i) => IMPATTI_GOOGLE[i.status_impact] ?? 'degradato');
  const stato = stati.length ? STATI.find((s) => stati.includes(s)) : 'operativo';
  const base = togliSlash(p.statusPage);
  return {
    stato,
    descrizione: attivi.length ? inCorso(attivi.length) : 'Nessun incidente in corso',
    incidenti: attivi.map((i) => ({
      titolo: i.external_desc,
      stato: i.most_recent_update?.status ?? i.status_impact,
      impatto: i.severity,
      tipo: 'incidente',
      servizio: i.service_name,
      url: i.uri ? `${base}/${i.uri}` : base,
      aggiornato: i.modified ?? i.begin,
    })),
  };
}

// Railway: pagina proprietaria, /api/status con activeIncidents e maintenances.
function manutenzioneInCorso(m, adesso) {
  if (/IN_PROGRESS|ACTIVE|ONGOING|STARTED/i.test(m.status ?? '')) return true;
  const inizio = Date.parse(m.startsAt ?? m.scheduledStartAt ?? m.start ?? '');
  const fine = Date.parse(m.endsAt ?? m.scheduledEndAt ?? m.end ?? '');
  return inizio <= adesso && (Number.isNaN(fine) || adesso <= fine) && !/COMPLETED|RESOLVED/i.test(m.status ?? '');
}

async function railway(p, fetchJson) {
  const s = await fetchJson(p.api);
  if (!Array.isArray(s?.entries) || !Array.isArray(s.activeIncidents)) throw new Error('struttura di /api/status inattesa');
  const attivi = s.activeIncidents.filter((i) => !i.resolvedAt);
  const adesso = Date.now();
  const manutenzioni = (s.maintenances ?? []).filter((m) => manutenzioneInCorso(m, adesso));
  const impatti = attivi.flatMap((i) => (i.components ?? []).map((c) => c.impact));

  let stato = 'operativo';
  if (impatti.some((x) => /OUTAGE/.test(x ?? ''))) stato = 'problemi';
  else if (attivi.length) stato = 'degradato';
  else if (manutenzioni.length) stato = 'manutenzione';

  const voce = (i, tipo) => ({
    titolo: i.title ?? i.name,
    stato: i.status,
    impatto: (i.components ?? []).map((c) => c.impact).find((x) => /OUTAGE/.test(x ?? '')),
    tipo,
    url: p.statusPage,
    aggiornato: i.updates?.[0]?.createdAt ?? i.createdAt,
  });
  return {
    stato,
    descrizione: attivi.length ? inCorso(attivi.length) : 'Nessun incidente in corso',
    incidenti: [...attivi.map((i) => voce(i, 'incidente')), ...manutenzioni.map((m) => voce(m, 'manutenzione'))],
  };
}

const LETTORI = { statuspage, instatus, 'google-incidents': googleIncidents, railway };

// Controlla un provider. Non lancia mai: se la risposta manca o non è valida lo stato è "sconosciuto".
export async function controlla(p, fetchJson) {
  const base = { id: p.id, nome: p.name, paginaUfficiale: p.statusPage, cors: Boolean(p.cors) };
  try {
    const lettore = LETTORI[p.type];
    if (!lettore) throw new Error(`tipo non gestito: ${p.type}`);
    const r = await lettore(p, fetchJson);
    return { ...base, ...r, errore: null, controllato: new Date().toISOString() };
  } catch (e) {
    return {
      ...base,
      stato: 'sconosciuto',
      descrizione: 'Nessuna risposta valida dalla pagina di stato',
      incidenti: [],
      errore: e?.cause?.message ? `${e.message}: ${e.cause.message}` : e?.message ?? String(e),
      controllato: new Date().toISOString(),
    };
  }
}
