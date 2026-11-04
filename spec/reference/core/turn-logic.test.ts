import { randomUUID as u } from 'node:crypto';
import { CommitPayloadSchema, type CommitSet, type CommitPayload } from '@mythos/contracts';
import { activeSets, staleStages, orderSets, definedIds, remapPayload, type IdMap } from './turn-logic';
import { eq } from '../test-support/harness';

const T = u();
let clock = 0;
const set = (stage: CommitSet['stage'], basedOn: string[] = [], supersedes: string | null = null): CommitSet => ({
  id: u(), turnId: T, stage, origin: 'model', supersedesSetId: supersedes, basedOnSetIds: basedOn,
  copiedFromSetId: null, schemaVersion: 1, seq: clock, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
});

// A full turn
const input = set('input', [], null);
const ruling = set('adjudication', [input.id]);
const resol = set('resolution', [input.id, ruling.id]);
const narr = set('narration', [input.id, ruling.id, resol.id]);
const extr = set('extraction', [input.id, ruling.id, resol.id, narr.id]);
const edit = set('player-edit');
let sets = [input, ruling, resol, narr, extr, edit];
eq('fresh turn has no stale stages', staleStages(sets), []);

// Player edits the ruling: new adjudication set supersedes the old one
const ruling2 = set('adjudication', [input.id], ruling.id);
sets = [...sets, ruling2];
eq('ruling edit stales resolution, narration, extraction', staleStages(sets), ['resolution', 'narration', 'extraction']);
eq('old ruling inactive', activeSets(sets).some((s) => s.id === ruling.id), false);

// Regenerate resolution and narration; extraction still stale (based on old narration)
const resol2 = set('resolution', [input.id, ruling2.id], resol.id);
const narr2 = set('narration', [input.id, ruling2.id, resol2.id], narr.id);
sets = [...sets, resol2, narr2];
eq('after regenerating resolution+narration, only extraction stale', staleStages(sets), ['extraction']);

// Restore the old narration version (copy with fresh basedOn = current upstream) — not stale
const narr3 = set('narration', [input.id, ruling2.id, resol2.id], narr2.id);
sets = [...sets, narr3];
eq('restored narration based on current upstream is fresh', staleStages(sets).includes('narration'), false);

// Order: stage first, then seq
eq('apply order follows stage order', orderSets(activeSets(sets)).map((s) => s.stage),
  ['input', 'adjudication', 'resolution', 'narration', 'extraction', 'player-edit']);

// ---- ID remapping for copy-on-write
const obsA = u(), obsB = u(), sharedObs = u(), statusId = u(), noteId = u();
const oldTurn = u(), newTurn = u();
const payloads: CommitPayload[] = [
  { type: 'observation.add', observation: { id: obsA, turnId: oldTurn, gameTime: 10, placeId: null, kind: 'event', text: 'A', actorIds: [], witnessIds: ['pc.wren'], mentionedIds: [], importance: 3, tags: [] } },
  { type: 'observation.add', observation: { id: obsB, turnId: oldTurn, gameTime: 10, placeId: null, kind: 'claim', text: 'B', actorIds: ['npc.varek'], witnessIds: ['pc.wren'], mentionedIds: [], importance: 5, tags: [],
      claim: { sourceId: 'npc.varek', audienceIds: ['pc.wren'], content: 'x', aboutObservationId: sharedObs, truthful: 'false' } } },
  { type: 'knowledge.grant', grant: { entityId: 'npc.odette', observationId: obsA, via: 'told', viaObservationId: obsB, gameTime: 11 } },
  { type: 'knowledge.grant', grant: { entityId: 'npc.odette', observationId: sharedObs, via: 'rumor', viaObservationId: null, gameTime: 11 } },
  { type: 'status.add', characterId: 'pc.wren', status: { id: statusId, name: 'Cut', kind: 'harm', level: 1, tags: ['physical'], permanent: false, treated: false, inflictedAt: 10, changedAt: 10 } },
  { type: 'status.update', characterId: 'pc.wren', statusId, changes: { level: 2 } },
  { type: 'relationship.adjust', fromId: 'npc.odette', toId: 'pc.wren', deltas: { trust: 1 }, summary: null, addKeyObservationIds: [obsA, sharedObs] },
  { type: 'note.upsert', note: { id: noteId, subjectId: null, text: 'n' } },
  { type: 'note.delete', noteId },
];
for (const p of payloads) CommitPayloadSchema.parse(p);

const defined = new Set(payloads.flatMap(definedIds));
const map = new Map<string, string>();
const m: IdMap = {
  defined: (id) => { let n = map.get(id); if (!n) { n = u(); map.set(id, n); } return n; },
  ref: (id) => (defined.has(id) ? m.defined(id) : id),
};
const out = payloads.map((p) => remapPayload(p, m, (t) => (t === oldTurn ? newTurn : t)));
for (const p of out) CommitPayloadSchema.parse(p);
const g = out[2] as Extract<CommitPayload, { type: 'knowledge.grant' }>;
const o1 = out[0] as Extract<CommitPayload, { type: 'observation.add' }>;
const o2 = out[1] as Extract<CommitPayload, { type: 'observation.add' }>;
eq('defined observation gets a new id', o1.observation.id !== obsA, true);
eq('observation turnId points at the copy', o1.observation.turnId, newTurn);
eq('grant follows remapped observation', g.grant.observationId, o1.observation.id);
eq('grant via follows remapped claim', g.grant.viaObservationId, o2.observation.id);
eq('reference to shared (uncopied) observation is kept', (out[3] as typeof g).grant.observationId, sharedObs);
eq('claim aboutObservationId to shared obs is kept', o2.observation.claim?.aboutObservationId, sharedObs);
const sa = out[4] as Extract<CommitPayload, { type: 'status.add' }>;
const su = out[5] as Extract<CommitPayload, { type: 'status.update' }>;
eq('status update follows remapped status', su.statusId, sa.status.id);
const ra = out[6] as Extract<CommitPayload, { type: 'relationship.adjust' }>;
eq('relationship key observations: copied remapped, shared kept', ra.addKeyObservationIds, [o1.observation.id, sharedObs]);
eq('original payloads untouched', (payloads[0] as typeof o1).observation.id, obsA);
eq('every defined id remapped exactly once', map.size, defined.size);
