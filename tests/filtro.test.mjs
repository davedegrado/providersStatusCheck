// Test del filtro "servizi che uso", con la configurazione reale di providers.json e casi presi dalle API (ottobre 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { controlla } from '../assets/providers.js';

const providers = JSON.parse(await readFile(new URL('../providers.json', import.meta.url), 'utf8'));
const prov = (id) => providers.find((p) => p.id === id);
const finto = (risposte) => async (url) => {
  if (!(url in risposte)) throw new Error('HTTP 404');
  return structuredClone(risposte[url]);
};

// Cloudflare: struttura Statuspage con gruppi.
const cf = prov('cloudflare');
const cfComp = (extra = []) => [
  { id: 'g-svc', name: 'Cloudflare Sites and Services', group: true },
  { id: 'g-eu', name: 'Europe', group: true },
  { id: 'g-na', name: 'North America', group: true },
  { id: 'dns', name: 'Authoritative DNS', status: 'operational', group_id: 'g-svc' },
  { id: 'workers', name: 'Workers', status: 'operational', group_id: 'g-svc' },
  { id: 'pages', name: 'Pages', status: 'operational', group_id: 'g-svc' },
  { id: 'custom-pages', name: 'Custom Pages', status: 'operational', group_id: 'g-svc' },
  { id: 'warp', name: 'WARP', status: 'degraded_performance', group_id: 'g-svc' },
  { id: 'mxp', name: 'Milan, Italy - (MXP)', status: 'operational', group_id: 'g-eu' },
  { id: 'ist', name: 'Istanbul, Turkey - (IST)', status: 'degraded_performance', group_id: 'g-eu' },
  { id: 'mex', name: 'Mexico City, Mexico - (MEX)', status: 'major_outage', group_id: 'g-na' },
  ...extra,
];
const cfRisposte = (summary) => ({
  [cf.api]: summary,
  [cf.api.replace('summary.json', 'components.json')]: { components: summary.components },
});

test('cloudflare: datacenter lontani e WARP non rendono rossa la scheda', async () => {
  const comps = cfComp();
  const r = await controlla(cf, finto(cfRisposte({
    status: { indicator: 'major', description: 'Partial System Outage' },
    components: comps,
    incidents: [{ id: 'w', name: 'Incorrect geo location for some Cloudflare WARP users', status: 'identified', impact: 'minor', components: [comps.find((c) => c.id === 'warp')] }],
    scheduled_maintenances: [],
  })));
  assert.equal(r.stato, 'operativo');
  assert.equal(r.descrizione, 'Nessun problema sui servizi che usi');
  assert.equal(r.incidenti[0].rilevante, false);
  assert.ok(r.note.some((n) => n.includes('Partial System Outage')));
  assert.ok(r.note.some((n) => /: Istanbul$/.test(n)), 'datacenter europei nella nota');
  assert.ok(!r.note.some((n) => n.includes('Mexico')));
});

test('cloudflare: Workers in outage = problemi; "Custom Pages" non è "Pages"', async () => {
  const comps = cfComp().map((c) => (c.id === 'workers' ? { ...c, status: 'major_outage' } : c.id === 'custom-pages' ? { ...c, status: 'major_outage' } : c));
  const r = await controlla(cf, finto(cfRisposte({ status: { indicator: 'major', description: 'x' }, components: comps, incidents: [], scheduled_maintenances: [] })));
  assert.equal(r.stato, 'problemi');
  assert.equal(r.descrizione, 'Problemi su: Workers');
});

test('cloudflare: incidente su un datacenter europeo = al massimo degradato', async () => {
  const comps = cfComp();
  const r = await controlla(cf, finto(cfRisposte({
    status: { indicator: 'major', description: 'x' },
    components: comps,
    incidents: [{ id: 'm', name: 'Network congestion in Milan', status: 'investigating', impact: 'major', components: [comps.find((c) => c.id === 'mxp')] }],
    scheduled_maintenances: [],
  })));
  assert.equal(r.stato, 'degradato');
  assert.deepEqual(r.incidenti[0].coinvolti, ['Milan, Italy']);
});

test('cloudflare: incidente senza componenti negli USA non conta, in Europa sì', async () => {
  const base = { status: { indicator: 'minor', description: 'x' }, components: cfComp(), scheduled_maintenances: [] };
  const usa = await controlla(cf, finto(cfRisposte({ ...base, incidents: [{ id: 'a', name: 'Network Performance Issues in Virginia and Ohio United States', status: 'investigating', impact: 'minor', components: [] }] })));
  assert.equal(usa.stato, 'operativo');
  const eu = await controlla(cf, finto(cfRisposte({ ...base, incidents: [{ id: 'b', name: 'Elevated latency in Europe', status: 'investigating', impact: 'minor', components: [] }] })));
  assert.equal(eu.stato, 'degradato');
});

// Supabase: incident.io, incidenti senza componenti, filtro sul titolo.
const sb = prov('supabase');
const sbRisposte = (incidents, comps = [{ id: '1', name: 'eu-central-1', status: 'operational' }]) => ({
  [sb.api]: { status: { indicator: 'major', description: 'Partial System Outage' }, components: comps.slice(0, 1) },
  [sb.api.replace('summary.json', 'incidents.json')]: { incidents },
  [sb.api.replace('summary.json', 'components.json')]: { components: comps },
});
const inc = (name, impact = 'major') => ({ id: name, name, status: 'investigating', impact });

test('supabase: incidenti di gestione o di altre regioni non contano', async () => {
  for (const titolo of [
    'Elevated Mgmt API Error Rates in Multiple Regions',
    'Project lifecycle operation errors in the EU region',
    'Intermittent connection errors via the connection pooler in us-east-1',
    'Project creation errors ap-ne1',
    'Edge Function Degradation',
  ]) {
    const r = await controlla(sb, finto(sbRisposte([inc(titolo)])));
    assert.equal(r.stato, 'operativo', titolo);
  }
});

test('supabase: incidenti generici o su eu-central-1 contano', async () => {
  for (const titolo of ['Projects stuck in restarting state', 'Database connectivity issues in eu-central-1 and us-east-1', 'Auth errors']) {
    const r = await controlla(sb, finto(sbRisposte([inc(titolo)])));
    assert.equal(r.stato, 'problemi', titolo);
  }
});

test('supabase: componente eu-central-1 non operativo = problemi, altre regioni no', async () => {
  const altre = await controlla(sb, finto(sbRisposte([], [{ id: '1', name: 'eu-central-1', status: 'operational' }, { id: '2', name: 'eu-west-1', status: 'partial_outage' }])));
  assert.equal(altre.stato, 'operativo');
  const mia = await controlla(sb, finto(sbRisposte([], [{ id: '1', name: 'eu-central-1', status: 'partial_outage' }])));
  assert.equal(mia.stato, 'problemi');
});

// Railway: incidenti con componenti e gruppi.
const rw = prov('railway');
const rwStato = (activeIncidents) => ({ [rw.api]: { entries: [], activeIncidents, maintenances: [] } });

test('railway: build bloccate = degradato (le app restano su), compute giù = problemi', async () => {
  const build = await controlla(rw, finto(rwStato([{
    title: 'Railway Platform Outage', status: 'IDENTIFIED', resolvedAt: null,
    components: [
      { name: 'Builds', groupName: 'EU West (Amsterdam, Netherlands)', impact: 'MAJOR_OUTAGE' },
      { name: 'API — backboard.railway.com', groupName: 'Railway', impact: 'PARTIAL_OUTAGE' },
      { name: 'Support & Community — station.railway.com', groupName: 'Railway', impact: 'MAJOR_OUTAGE' },
    ],
  }])));
  assert.equal(build.stato, 'degradato');
  const compute = await controlla(rw, finto(rwStato([{ title: 'Outage', status: 'IDENTIFIED', resolvedAt: null, components: [{ name: 'Compute', groupName: 'EU West (Amsterdam, Netherlands)', impact: 'MAJOR_OUTAGE' }] }])));
  assert.equal(compute.stato, 'problemi');
});

test('railway: incidente solo su Central Station non conta', async () => {
  const r = await controlla(rw, finto(rwStato([{ title: 'Central Station not loading', status: 'IDENTIFIED', resolvedAt: null, components: [{ name: 'Support & Community — station.railway.com', groupName: 'Railway', impact: 'DEGRADED_PERFORMANCE' }] }])));
  assert.equal(r.stato, 'operativo');
  assert.equal(r.incidenti[0].rilevante, false);
});

// Firebase: filtro sui prodotti.
const fb = prov('firebase');

test('firebase: conta solo Cloud Messaging; incidenti senza prodotto contano', async () => {
  const rtdb = await controlla(fb, finto({ [fb.api]: [{ external_desc: 'RTDB lento', status_impact: 'SERVICE_DISRUPTION', affected_products: [{ title: 'Realtime Database' }] }] }));
  assert.equal(rtdb.stato, 'operativo');
  const fcm = await controlla(fb, finto({ [fb.api]: [{ external_desc: 'FCM down', status_impact: 'SERVICE_OUTAGE', affected_products: [{ title: 'Cloud Messaging' }] }] }));
  assert.equal(fcm.stato, 'problemi');
  const ignoto = await controlla(fb, finto({ [fb.api]: [{ external_desc: '?', status_impact: 'SERVICE_DISRUPTION' }] }));
  assert.equal(ignoto.stato, 'degradato');
});

// Resend: nessun componente negli incidenti.
const rs = prov('resend');

test('resend: invio e webhook contano, broadcast e provisioning no', async () => {
  const r = (titolo) => controlla(rs, finto({
    [rs.api]: { status: { indicator: 'minor', description: 'x' }, components: [] },
    [rs.api.replace('summary.json', 'incidents.json')]: { incidents: [inc(titolo, 'minor')] },
    [rs.api.replace('summary.json', 'components.json')]: { components: [] },
  }));
  assert.equal((await r('Delayed email sending')).stato, 'degradato');
  assert.equal((await r('Increased latency in WebHooks')).stato, 'degradato');
  assert.equal((await r('Broadcast Emails delayed')).stato, 'operativo');
  assert.equal((await r('Delayed new team provisioning and contact webhook delivery')).stato, 'operativo');
});

// GitHub: tutto "secondario", mai più di degradato.
const gh = prov('github');

test('github: anche un outage di Actions resta "degradato"', async () => {
  const actions = { id: 'a', name: 'Actions', status: 'major_outage' };
  const r = await controlla(gh, finto({
    [gh.api]: { status: { indicator: 'major', description: 'x' }, components: [actions], incidents: [{ id: 'i', name: 'Incident with Actions', status: 'investigating', impact: 'major', components: [actions] }], scheduled_maintenances: [] },
    [gh.api.replace('summary.json', 'components.json')]: { components: [actions] },
  }));
  assert.equal(r.stato, 'degradato');
});
