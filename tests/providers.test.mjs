// Test dei normalizzatori con risposte nel formato osservato sulle API reali (ottobre 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlla } from '../assets/providers.js';

const finto = (risposte) => async (url) => {
  if (!(url in risposte)) throw new Error('HTTP 404');
  const r = risposte[url];
  if (r instanceof Error) throw r;
  return structuredClone(r);
};

const sp = { id: 'x', name: 'X', statusPage: 'https://status.x.com/', api: 'https://status.x.com/api/v2/summary.json', type: 'statuspage', cors: true };

test('statuspage: tutto operativo', async () => {
  const r = await controlla(sp, finto({ [sp.api]: { status: { indicator: 'none', description: 'All Systems Operational' }, incidents: [], scheduled_maintenances: [] } }));
  assert.equal(r.stato, 'operativo');
  assert.equal(r.errore, null);
  assert.deepEqual(r.incidenti, []);
});

test('statuspage: incidente attivo e manutenzione programmata non in corso', async () => {
  const r = await controlla(sp, finto({
    [sp.api]: {
      status: { indicator: 'major', description: 'Partial System Outage' },
      incidents: [
        { id: 'a1', name: 'Project lifecycle errors', status: 'monitoring', impact: 'major', updated_at: '2026-10-22T09:00:00Z' },
        { id: 'a2', name: 'Vecchio', status: 'resolved', impact: 'minor' },
      ],
      scheduled_maintenances: [{ id: 'm1', name: 'Futura', status: 'scheduled' }],
    },
  }));
  assert.equal(r.stato, 'problemi');
  assert.equal(r.incidenti.length, 1);
  assert.equal(r.incidenti[0].url, 'https://status.x.com/incidents/a1');
});

test('statuspage: manutenzione in corso', async () => {
  const r = await controlla(sp, finto({ [sp.api]: { status: { indicator: 'maintenance', description: 'Service Under Maintenance' }, incidents: [], scheduled_maintenances: [{ id: 'm', name: 'DB', status: 'in_progress' }] } }));
  assert.equal(r.stato, 'manutenzione');
  assert.equal(r.incidenti[0].tipo, 'manutenzione');
});

test('statuspage (incident.io): summary senza incidenti, letti da incidents.json', async () => {
  const r = await controlla(sp, finto({
    [sp.api]: { status: { indicator: 'minor', description: 'Minor Service Outage' }, components: [] },
    'https://status.x.com/api/v2/incidents.json': { incidents: [{ id: 'i', name: 'Webhook in ritardo', status: 'investigating', impact: 'minor' }, { id: 'j', name: 'Chiuso', status: 'resolved' }] },
  }));
  assert.equal(r.stato, 'degradato');
  assert.deepEqual(r.incidenti.map((i) => i.titolo), ['Webhook in ritardo']);
});

test('statuspage: indicatore sconosciuto o risposta HTML danno "sconosciuto"', async () => {
  const a = await controlla(sp, finto({ [sp.api]: { status: { indicator: 'boh' } } }));
  assert.equal(a.stato, 'sconosciuto');
  const b = await controlla(sp, finto({ [sp.api]: new Error('risposta non JSON') }));
  assert.equal(b.stato, 'sconosciuto');
  assert.equal(b.errore, 'risposta non JSON');
});

test('provider che non risponde: "sconosciuto", mai "operativo"', async () => {
  const r = await controlla(sp, finto({}));
  assert.equal(r.stato, 'sconosciuto');
  assert.equal(r.errore, 'HTTP 404');
});

const fb = { id: 'firebase', name: 'Firebase', statusPage: 'https://status.firebase.google.com', api: 'https://status.firebase.google.com/incidents.json', type: 'google-incidents', cors: true };

test('google-incidents: incidenti senza end sono attivi', async () => {
  const r = await controlla(fb, finto({
    [fb.api]: [
      { id: 'a', external_desc: 'RTDB lento', begin: '2026-10-21T13:05:00+00:00', modified: '2026-10-21T14:39:25+00:00', status_impact: 'SERVICE_DISRUPTION', severity: 'medium', service_name: 'Realtime Database', most_recent_update: { status: 'SERVICE_DISRUPTION' }, uri: 'incidents/a' },
      { id: 'b', external_desc: 'Chiuso', end: '2026-10-17T08:00:00+00:00', status_impact: 'SERVICE_OUTAGE', uri: 'incidents/b' },
    ],
  }));
  assert.equal(r.stato, 'degradato');
  assert.equal(r.incidenti.length, 1);
  assert.equal(r.incidenti[0].url, 'https://status.firebase.google.com/incidents/a');
});

test('google-incidents: un outage prevale sul degrado; nessun incidente = operativo', async () => {
  const r = await controlla(fb, finto({ [fb.api]: [{ status_impact: 'SERVICE_DISRUPTION' }, { status_impact: 'SERVICE_OUTAGE' }] }));
  assert.equal(r.stato, 'problemi');
  const ok = await controlla(fb, finto({ [fb.api]: [{ end: '2026-10-01T00:00:00Z', status_impact: 'SERVICE_OUTAGE' }] }));
  assert.equal(ok.stato, 'operativo');
});

const rw = { id: 'railway', name: 'Railway', statusPage: 'https://status.railway.com', api: 'https://status.railway.com/api/status', type: 'railway', cors: false };

test('railway: incidente con componenti in outage', async () => {
  const r = await controlla(rw, finto({
    [rw.api]: {
      entries: [],
      activeIncidents: [{
        title: 'Railway Platform Outage', status: 'IDENTIFIED', createdAt: '2026-10-21T07:24:24Z', resolvedAt: null,
        components: [{ name: 'Builds', impact: 'MAJOR_OUTAGE' }, { name: 'API', impact: 'PARTIAL_OUTAGE' }],
        updates: [{ status: 'IDENTIFIED', createdAt: '2026-10-22T09:28:14Z' }],
      }],
      maintenances: [],
    },
  }));
  assert.equal(r.stato, 'problemi');
  assert.equal(r.incidenti[0].aggiornato, '2026-10-22T09:28:14Z');
  assert.equal(r.incidenti[0].impatto, 'MAJOR_OUTAGE');
});

test('railway: niente incidenti = operativo; manutenzione in corso', async () => {
  const ok = await controlla(rw, finto({ [rw.api]: { entries: [], activeIncidents: [], maintenances: [] } }));
  assert.equal(ok.stato, 'operativo');
  const m = await controlla(rw, finto({ [rw.api]: { entries: [], activeIncidents: [], maintenances: [{ title: 'DB', status: 'IN_PROGRESS' }] } }));
  assert.equal(m.stato, 'manutenzione');
});

test('railway: struttura inattesa = sconosciuto', async () => {
  const r = await controlla(rw, finto({ [rw.api]: { foo: 1 } }));
  assert.equal(r.stato, 'sconosciuto');
});

test('tipo non gestito = sconosciuto', async () => {
  const r = await controlla({ ...sp, type: 'altro' }, finto({}));
  assert.equal(r.stato, 'sconosciuto');
});
