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
const peggiore = (stati) => STATI.find((s) => stati.includes(s)) ?? 'operativo';
const nomeBreve = (etichetta) => etichetta.split(' / ').at(-1).replace(/\s+-\s+\(\w+\)$/, '');

// --- Filtro "servizi che uso" -------------------------------------------------
// In providers.json ogni provider può avere un "filtro" con espressioni regolari (senza distinzione maiuscole),
// confrontate con l'etichetta "Gruppo / Componente" (o solo "Componente" se non c'è gruppo):
//   componenti     servizi da cui dipendono le tue app: decidono lo stato
//   secondari      servizi che toccano il tuo lavoro (build, deploy, dashboard): al massimo "degradato"
//   soloIncidenti  contano solo se citati in un incidente, come "secondari" (es. i datacenter vicini)
// Per gli incidenti che non dicono quali componenti toccano si guarda il titolo:
//   ignora   titolo su funzioni che non usi: incidente non rilevante
//   altrove  titolo su altre regioni: non rilevante, a meno che citi anche "qui"
// Nel dubbio un incidente è rilevante.
const espressioni = (lista) => (lista ?? []).map((x) => new RegExp(x, 'i'));
const corrisponde = (testo, lista) => lista.some((r) => r.test(testo));

function preparaFiltro(f) {
  if (!f) return null;
  return {
    critici: espressioni(f.componenti),
    secondari: espressioni(f.secondari),
    soloIncidenti: espressioni(f.soloIncidenti),
    ignora: espressioni(f.ignora),
    altrove: espressioni(f.altrove),
    qui: espressioni(f.qui),
    nomeInfo: f.nomeInfo,
  };
}

function peso(F, etichetta, perIncidente) {
  if (corrisponde(etichetta, F.critici)) return 'critico';
  if (corrisponde(etichetta, F.secondari)) return 'secondario';
  if (perIncidente && corrisponde(etichetta, F.soloIncidenti)) return 'secondario';
  return null;
}

// Rilevanza di un incidente: dai componenti coinvolti se l'API li riporta, altrimenti dal titolo.
function valutaIncidente(F, etichette, testo) {
  if (!F) return { rilevante: true, peso: 'critico', coinvolti: [] };
  if (etichette.length) {
    const toccati = etichette.filter((e) => peso(F, e, true));
    if (!toccati.length) return { rilevante: false, coinvolti: [] };
    const critico = toccati.some((e) => peso(F, e, true) === 'critico');
    return { rilevante: true, peso: critico ? 'critico' : 'secondario', coinvolti: [...new Set(toccati.map(nomeBreve))] };
  }
  if (corrisponde(testo, F.ignora)) return { rilevante: false, coinvolti: [] };
  if (corrisponde(testo, F.altrove) && !corrisponde(testo, F.qui)) return { rilevante: false, coinvolti: [] };
  return { rilevante: true, peso: 'critico', coinvolti: [] };
}

const limita = (stato, p) => (p === 'secondario' && stato === 'problemi' ? 'degradato' : stato);

// Riassume i componenti "soloIncidenti" non operativi (es. datacenter europei), solo a titolo informativo.
function notaInfo(F, nonOperativi) {
  if (!F?.soloIncidenti.length) return null;
  // Per i datacenter basta la città: "Istanbul, Turkey - (IST)" → "Istanbul".
  const nomi = nonOperativi.filter((e) => corrisponde(e, F.soloIncidenti)).map((e) => nomeBreve(e).split(',')[0].trim());
  if (!nomi.length) return null;
  return `${F.nomeInfo ?? 'Componenti secondari non operativi'} (${nomi.length}): ${nomi.slice(0, 6).join(', ')}${nomi.length > 6 ? '…' : ''}`;
}

// Statuspage di Atlassian e pagine compatibili (incident.io).
const INDICATORI = { none: 'operativo', minor: 'degradato', major: 'problemi', critical: 'problemi', maintenance: 'manutenzione' };
const INCIDENTE_CHIUSO = new Set(['resolved', 'postmortem', 'completed']);
const MANUTENZIONE_IN_CORSO = new Set(['in_progress', 'verifying']);

const STATI_COMPONENTE = {
  operational: 'operativo', degraded_performance: 'degradato', partial_outage: 'problemi', major_outage: 'problemi', under_maintenance: 'manutenzione',
};
const STATI_IMPATTO = { critical: 'problemi', major: 'problemi', minor: 'degradato', none: 'degradato', maintenance: 'manutenzione' };

async function statuspage(p, fetchJson) {
  const s = await fetchJson(p.api);
  const indicatore = s?.status?.indicator;
  if (!indicatore) throw new Error('risposta senza status.indicator');
  const F = preparaFiltro(p.filtro);

  let incidenti = s.incidents;
  if (!Array.isArray(incidenti)) {
    // incident.io può omettere gli incidenti dal summary: li prende da incidents.json, se c'è.
    try {
      incidenti = (await fetchJson(p.api.replace(/summary\.json$/, 'incidents.json'))).incidents ?? [];
    } catch {
      incidenti = [];
    }
  }
  let componenti = s.components ?? [];
  if (F) {
    // incident.io tronca i componenti nel summary: l'elenco completo è in components.json.
    try {
      componenti = (await fetchJson(p.api.replace(/summary\.json$/, 'components.json'))).components ?? componenti;
    } catch { /* restano quelli del summary */ }
  }
  const gruppi = new Map(componenti.filter((c) => c.group).map((c) => [c.id, c.name]));
  const etichetta = (c) => (gruppi.get(c.group_id) ? `${gruppi.get(c.group_id)} / ${c.name}` : c.name);

  const attivi = incidenti.filter((i) => !INCIDENTE_CHIUSO.has(i.status));
  const manutenzioni = (s.scheduled_maintenances ?? []).filter((m) => MANUTENZIONE_IN_CORSO.has(m.status));
  const base = togliSlash(p.statusPage);
  const voce = (i, tipo) => {
    const v = valutaIncidente(F, (i.components ?? []).map(etichetta), `${i.name} ${i.incident_updates?.[0]?.body ?? ''}`);
    const gravita = tipo === 'manutenzione' ? 'manutenzione' : (STATI_IMPATTO[i.impact] ?? 'degradato');
    return {
      titolo: i.name,
      stato: i.status,
      impatto: i.impact,
      tipo,
      url: i.shortlink || `${base}/incidents/${i.id}`,
      aggiornato: i.updated_at ?? i.created_at,
      rilevante: v.rilevante,
      coinvolti: v.coinvolti,
      gravita: v.rilevante ? limita(gravita, v.peso) : null,
    };
  };
  const voci = [...attivi.map((i) => voce(i, 'incidente')), ...manutenzioni.map((m) => voce(m, 'manutenzione'))];

  if (!F) {
    let stato = INDICATORI[indicatore] ?? 'sconosciuto';
    if (stato === 'operativo' && attivi.length) stato = 'degradato';
    if (stato === 'operativo' && manutenzioni.length) stato = 'manutenzione';
    return { stato, descrizione: s.status.description, incidenti: voci, note: [] };
  }

  const foglie = componenti.filter((c) => !c.group);
  const nonOperativi = foglie.filter((c) => c.status && c.status !== 'operational');
  const toccati = nonOperativi
    .map((c) => ({ c, peso: peso(F, etichetta(c), false) }))
    .filter((x) => x.peso);
  const stato = peggiore([
    ...toccati.map((x) => limita(STATI_COMPONENTE[x.c.status] ?? 'degradato', x.peso)),
    ...voci.filter((v) => v.rilevante).map((v) => v.gravita),
  ]);
  const nomi = [...new Set(toccati.map((x) => nomeBreve(etichetta(x.c))))];
  const rilevanti = voci.filter((v) => v.rilevante).length;
  const descrizione = stato === 'operativo'
    ? 'Nessun problema sui servizi che usi'
    : nomi.length ? `Problemi su: ${nomi.slice(0, 5).join(', ')}${nomi.length > 5 ? '…' : ''}` : inCorso(rilevanti);
  const note = [
    indicatore !== 'none' ? `Stato generale del provider: ${s.status.description}` : null,
    notaInfo(F, nonOperativi.map(etichetta)),
  ].filter(Boolean);
  return { stato, descrizione, incidenti: voci, note };
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
    rilevante: true,
    coinvolti: [],
  });
  return {
    stato,
    descrizione: null,
    incidenti: [...attivi.map((i) => voce(i, 'incidente')), ...manutenzioni.map((m) => voce(m, 'manutenzione'))],
    note: [],
  };
}

// Google Cloud / Firebase: array di incidenti, quelli senza "end" sono in corso.
const IMPATTI_GOOGLE = { SERVICE_OUTAGE: 'problemi', SERVICE_DISRUPTION: 'degradato', SERVICE_INFORMATION: 'degradato' };

async function googleIncidents(p, fetchJson) {
  const lista = await fetchJson(p.api);
  if (!Array.isArray(lista)) throw new Error('risposta non è un elenco di incidenti');
  const F = preparaFiltro(p.filtro);
  const attivi = lista.filter((i) => !i.end);
  const base = togliSlash(p.statusPage);
  const voci = attivi.map((i) => {
    const v = valutaIncidente(F, (i.affected_products ?? []).map((x) => x.title), i.external_desc ?? '');
    return {
      titolo: i.external_desc,
      stato: i.most_recent_update?.status ?? i.status_impact,
      impatto: i.severity,
      tipo: 'incidente',
      servizio: i.service_name,
      url: i.uri ? `${base}/${i.uri}` : base,
      aggiornato: i.modified ?? i.begin,
      rilevante: v.rilevante,
      coinvolti: v.coinvolti,
      gravita: v.rilevante ? limita(IMPATTI_GOOGLE[i.status_impact] ?? 'degradato', v.peso) : null,
    };
  });
  const rilevanti = voci.filter((v) => v.rilevante);
  const stato = peggiore(rilevanti.map((v) => v.gravita));
  return {
    stato,
    descrizione: rilevanti.length ? inCorso(rilevanti.length) : F ? 'Nessun problema sui servizi che usi' : 'Nessun incidente in corso',
    incidenti: voci,
    note: [],
  };
}

// Railway: pagina proprietaria, /api/status con activeIncidents e maintenances.
function manutenzioneInCorso(m, adesso) {
  if (/IN_PROGRESS|ACTIVE|ONGOING|STARTED/i.test(m.status ?? '')) return true;
  const inizio = Date.parse(m.startsAt ?? m.scheduledStartAt ?? m.start ?? '');
  const fine = Date.parse(m.endsAt ?? m.scheduledEndAt ?? m.end ?? '');
  return inizio <= adesso && (Number.isNaN(fine) || adesso <= fine) && !/COMPLETED|RESOLVED/i.test(m.status ?? '');
}

const IMPATTI_RAILWAY = (x) => (/OUTAGE/.test(x ?? '') ? 'problemi' : /MAINTENANCE/.test(x ?? '') ? 'manutenzione' : 'degradato');

async function railway(p, fetchJson) {
  const s = await fetchJson(p.api);
  if (!Array.isArray(s?.entries) || !Array.isArray(s.activeIncidents)) throw new Error('struttura di /api/status inattesa');
  const F = preparaFiltro(p.filtro);
  const adesso = Date.now();
  const attivi = s.activeIncidents.filter((i) => !i.resolvedAt);
  const manutenzioni = (s.maintenances ?? []).filter((m) => manutenzioneInCorso(m, adesso));
  const etichetta = (c) => (c.groupName ? `${c.groupName} / ${c.name}` : c.name);

  const voce = (i, tipo) => {
    const comp = i.components ?? [];
    const v = valutaIncidente(F, comp.map(etichetta), i.title ?? i.name ?? '');
    // La gravità viene solo dai componenti che ti riguardano, non da quelli altrui.
    const propri = F ? comp.filter((c) => peso(F, etichetta(c), true)) : comp;
    // Un incidente aperto conta almeno come "degradato", anche se i componenti risultano operativi.
    const daComponenti = peggiore(propri.map((c) => IMPATTI_RAILWAY(c.impact)));
    const gravita = tipo === 'manutenzione' ? 'manutenzione' : daComponenti === 'operativo' ? 'degradato' : daComponenti;
    return {
      titolo: i.title ?? i.name,
      stato: i.status,
      impatto: propri.map((c) => c.impact).find((x) => /OUTAGE/.test(x ?? '')),
      tipo,
      url: p.statusPage,
      aggiornato: i.updates?.[0]?.createdAt ?? i.createdAt,
      rilevante: v.rilevante,
      coinvolti: v.coinvolti,
      gravita: v.rilevante ? limita(gravita, v.peso) : null,
    };
  };
  const voci = [...attivi.map((i) => voce(i, 'incidente')), ...manutenzioni.map((m) => voce(m, 'manutenzione'))];
  const rilevanti = voci.filter((v) => v.rilevante);
  const stato = peggiore(rilevanti.map((v) => v.gravita));
  return {
    stato,
    descrizione: rilevanti.length ? inCorso(rilevanti.length) : F ? 'Nessun problema sui servizi che usi' : 'Nessun incidente in corso',
    incidenti: voci,
    note: [],
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
      note: [],
      errore: e?.cause?.message ? `${e.message}: ${e.cause.message}` : e?.message ?? String(e),
      controllato: new Date().toISOString(),
    };
  }
}
