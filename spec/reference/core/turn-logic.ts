import { CommitStageSchema, type CommitPayload, type CommitSet, type CommitStage } from '@mythos/contracts';

/** CON-084 order: stage, then the set's creation sequence. */
const STAGE_ORDER: readonly CommitStage[] = CommitStageSchema.options;

export function orderSets(sets: CommitSet[]): CommitSet[] {
  return [...sets].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.seq - b.seq);
}

/** Active = no other set supersedes it (CON-081). */
export function activeSets(sets: CommitSet[]): CommitSet[] {
  const superseded = new Set(sets.map((s) => s.supersedesSetId).filter((x): x is string => x !== null));
  return sets.filter((s) => !superseded.has(s.id));
}

/** A set is stale if any set it was based on is no longer active (CON-083). */
export function staleStages(sets: CommitSet[]): CommitStage[] {
  const active = activeSets(sets);
  const activeIds = new Set(active.map((s) => s.id));
  const stale = new Set<CommitStage>();
  for (const s of active) if (s.basedOnSetIds.some((id) => !activeIds.has(id))) stale.add(s.stage);
  return STAGE_ORDER.filter((st) => stale.has(st));
}

/**
 * ID remapping for copy-on-write (TRN §8). `defined` returns new IDs for UUIDs *defined*
 * in the copied range; `ref` remaps a reference only if its target was copied.
 */
export type IdMap = { defined(id: string): string; ref(id: string): string };

/** Pass 1: UUIDs a payload defines. */
export function definedIds(p: CommitPayload): string[] {
  switch (p.type) {
    case 'status.add': return [p.status.id];
    case 'scene.start': return [p.sceneId];
    case 'observation.add': return [p.observation.id];
    case 'note.upsert': return [p.note.id];
    case 'belief.upsert': return [p.belief.id];
    case 'input.set': case 'ruling.set': case 'roll.record': case 'narration.set': case 'override.record':
    case 'resolution.record': case 'harm.mitigate': case 'item.quantity': case 'knowledge.name': case 'tick.record':
    case 'entity.create': case 'entity.update-narrative': case 'entity.move': case 'entity.death':
    case 'stat.change': case 'status.update': case 'status.remove': case 'clock.create': case 'clock.tick':
    case 'clock.delete': case 'item.move': case 'time.advance': case 'flag.set': case 'observation.amend':
    case 'knowledge.grant': case 'knowledge.revoke': case 'relationship.adjust': case 'relationship.set':
    case 'wiki.patch': case 'note.delete': case 'belief.delete':
      return [];
    default: { const never: never = p; return never; }
  }
}

/** Pass 2: rewrite a payload. Exhaustive: a new commit type fails to compile here. */
export function remapPayload(p: CommitPayload, m: IdMap, newTurnId: (old: string) => string): CommitPayload {
  switch (p.type) {
    case 'status.add': return { ...p, status: { ...p.status, id: m.defined(p.status.id) } };
    case 'status.update': return { ...p, statusId: m.ref(p.statusId) };
    case 'status.remove': return { ...p, statusId: m.ref(p.statusId) };
    case 'scene.start': return { ...p, sceneId: m.defined(p.sceneId) };
    case 'observation.add': {
      const o = p.observation;
      return { ...p, observation: {
        ...o, id: m.defined(o.id), turnId: newTurnId(o.turnId),
        ...(o.claim ? { claim: { ...o.claim, aboutObservationId: o.claim.aboutObservationId === null ? null : m.ref(o.claim.aboutObservationId) } } : {}),
        ...(o.summarizesIds ? { summarizesIds: o.summarizesIds.map(m.ref) } : {}),
      } };
    }
    case 'observation.amend': return { ...p, observationId: m.ref(p.observationId) };
    case 'knowledge.grant': return { ...p, grant: { ...p.grant, observationId: m.ref(p.grant.observationId),
      viaObservationId: p.grant.viaObservationId === null ? null : m.ref(p.grant.viaObservationId) } };
    case 'knowledge.revoke': return { ...p, observationId: m.ref(p.observationId) };
    case 'relationship.adjust': return { ...p, addKeyObservationIds: p.addKeyObservationIds.map(m.ref) };
    case 'wiki.patch': return p.op.op === 'upsert-section'
      ? { ...p, op: { ...p.op, sourceObservationIds: p.op.sourceObservationIds.map(m.ref) } } : p;
    case 'note.upsert': return { ...p, note: { ...p.note, id: m.defined(p.note.id) } };
    case 'note.delete': return { ...p, noteId: m.ref(p.noteId) };
    case 'belief.upsert': return { ...p, belief: { ...p.belief, id: m.defined(p.belief.id) } };
    case 'belief.delete': return { ...p, beliefId: m.ref(p.beliefId) };
    // No runtime UUIDs (EntityIds and ClockIds are stable across copies):
    case 'input.set': case 'ruling.set': case 'roll.record': case 'narration.set': case 'override.record':
    case 'resolution.record': case 'harm.mitigate': case 'item.quantity': case 'knowledge.name': case 'tick.record':
    case 'entity.create': case 'entity.update-narrative': case 'entity.move': case 'entity.death':
    case 'stat.change': case 'clock.create': case 'clock.tick': case 'clock.delete': case 'item.move':
    case 'time.advance': case 'flag.set': case 'relationship.set':
      return p;
    default: { const never: never = p; return never; }
  }
}
