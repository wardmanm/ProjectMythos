import type { CommitPayload, Entity, Extraction, KnowledgeGrant, Observation, RetrievedObservation, SemanticIssue } from '@mythos/contracts';
import type { Ruleset } from '@mythos/contracts/content';

// ===================================================================== extraction → commits (MEM §4.4)

export type ExtractionContext = {
  turnId: string;
  gameTime: number; // end of the turn's resolution
  scenePlaceId: string;
  pcId: string;
  entities: Record<string, Entity>; // world state at the extraction point
  nearbyEntityIds: string[]; // the entity list shown in the prompt, for duplicate checks
  handles: Record<string, string>; // '#12' → observation UUID
  statusIdsByName(characterId: string, name: string): string[];
  ruleset: Ruleset;
  newUuid(): string;
  newEntityId(kind: string, name: string): string;
};

/** How the shared mapping differs between extraction and world ticks (TIME §5.5). */
export type ConversionOptions = {
  mode: 'extraction' | 'world-tick';
  pcMayWitness: boolean; // world ticks: only during time skips (TIME-072)
  observationTime?: (index: number) => number; // world ticks: per-observation game time
};

export function extractionToCommits(x: Extraction, ctx: ExtractionContext,
  opts: ConversionOptions = { mode: 'extraction', pcMayWitness: true }): { commits: CommitPayload[]; issues: SemanticIssue[] } {
  const offscreen = opts.mode === 'world-tick';
  const issues: SemanticIssue[] = [];
  const commits: CommitPayload[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  const lower = (s: string) => s.trim().toLowerCase();

  // 1. New entities get real IDs first, so every later reference can resolve.
  const newIds: Record<string, string> = {};
  const nearbyNames = new Map<string, string>();
  for (const id of ctx.nearbyEntityIds) {
    const e = ctx.entities[id];
    if (e) for (const n of [e.name, ...e.aliases]) nearbyNames.set(lower(n), id);
  }
  x.newEntities.forEach((n, i) => {
    if (newIds[n.ref]) issue(`newEntities[${i}].ref`, `${n.ref} is defined twice`);
    const dupe = [n.name, ...n.aliases].map((s) => nearbyNames.get(lower(s))).find(Boolean);
    if (dupe) issue(`newEntities[${i}]`, `"${n.name}" looks like existing ${dupe}; reference it instead of creating it`);
    newIds[n.ref] = ctx.newEntityId(n.kind, n.name);
  });
  const ent = (ref: string, path: string): string | null => {
    if (ref.startsWith('new.')) {
      const id = newIds[ref];
      if (!id) issue(path, `${ref} is not defined in newEntities`);
      return id ?? null;
    }
    if (!ctx.entities[ref]) { issue(path, `${ref} does not exist`); return null; }
    return ref;
  };
  const isCharacter = (id: string | null) => {
    if (!id) return false;
    const e = ctx.entities[id] ?? x.newEntities.find((n) => newIds[n.ref] === id);
    return e?.kind === 'npc' || e?.kind === 'pc';
  };

  x.newEntities.forEach((n, i) => {
    const id = newIds[n.ref] as string;
    const base = { id, name: n.name, aliases: n.aliases, tags: [] as string[] };
    if (n.kind === 'npc') {
      const stats = Object.fromEntries(ctx.ruleset.stats.list.map((s) => [s.id, n.stats[s.id] ?? ctx.ruleset.stats.default]));
      commits.push({ type: 'entity.create', entity: { ...base, kind: 'npc', ageCategory: n.ageCategory, stats, statuses: [],
        physicalDescription: n.physicalDescription, personality: n.personality, goals: [], keyNpc: false,
        locationId: n.locationId === null ? null : ent(n.locationId, `newEntities[${i}].locationId`), lifeState: 'alive' } });
    } else if (n.kind === 'place') {
      commits.push({ type: 'entity.create', entity: { ...base, kind: 'place', description: n.description,
        parentPlaceId: n.parentPlaceId === null ? null : ent(n.parentPlaceId, `newEntities[${i}].parentPlaceId`) } });
    } else if (n.kind === 'faction') {
      commits.push({ type: 'entity.create', entity: { ...base, kind: 'faction', description: n.description, goals: [] } });
    } else {
      const loc = resolveLocation(n.location, `newEntities[${i}].location`);
      const ownerId = n.ownerId === null ? null : ent(n.ownerId, `newEntities[${i}].ownerId`);
      if (loc) commits.push({ type: 'entity.create', entity: { ...base, kind: 'item', description: n.description, location: loc,
        ownerId, quantity: n.quantity, bonuses: [],
        ...(n.size !== null ? { size: n.size } : {}), ...(n.weight !== null ? { weight: n.weight } : {}),
        ...(n.container !== null ? { container: n.container } : {}) } });
    }
  });

  function resolveLocation(l: Extraction['itemMoves'][number]['to'], path: string) {
    switch (l.type) {
      case 'gone': return l;
      case 'held': case 'carried': { const c = ent(l.characterId, `${path}.characterId`); return c ? { ...l, characterId: c } : null; }
      case 'worn': { const c = ent(l.characterId, `${path}.characterId`); return c ? { ...l, characterId: c } : null; }
      case 'contained': { const c = ent(l.containerId, `${path}.containerId`); return c ? { ...l, containerId: c } : null; }
      case 'placed': { const p = ent(l.placeId, `${path}.placeId`); return p ? { ...l, placeId: p } : null; }
    }
  }

  // 2. Updates and movement. A PC move starts a new scene (MEM-054).
  x.entityUpdates.forEach((u, i) => {
    const id = ent(u.entityId, `entityUpdates[${i}].entityId`);
    if (!id) return;
    const e = ctx.entities[id];
    const fields: Extract<CommitPayload, { type: 'entity.update-narrative' }>['fields'] = {};
    if (u.name !== null) fields.name = u.name;
    if (u.addAliases.length && e) fields.aliases = [...new Set([...e.aliases, ...u.addAliases])];
    if (u.physicalDescription !== null) fields.physicalDescription = u.physicalDescription;
    if (u.description !== null) fields.description = u.description;
    if (Object.keys(fields).length) commits.push({ type: 'entity.update-narrative', entityId: id, fields });
  });
  const movedTo = new Map<string, string | null>();
  let pcMovedTo: string | null = null;
  x.moves.forEach((m, i) => {
    const c = ent(m.characterId, `moves[${i}].characterId`);
    const p = m.toPlaceId === null ? null : ent(m.toPlaceId, `moves[${i}].toPlaceId`);
    if (!c) return;
    if (!isCharacter(c)) { issue(`moves[${i}].characterId`, `${c} is not a character`); return; }
    if (offscreen && c === ctx.pcId) { issue(`moves[${i}].characterId`, 'only the player moves the PC'); return; }
    commits.push({ type: 'entity.move', characterId: c, toPlaceId: p });
    movedTo.set(c, p);
    if (c === ctx.pcId && p !== null && p !== ctx.scenePlaceId) pcMovedTo = p;
  });
  if (pcMovedTo) commits.push({ type: 'scene.start', sceneId: ctx.newUuid(), placeId: pcMovedTo });
  x.itemMoves.forEach((m, i) => {
    const item = ent(m.itemId, `itemMoves[${i}].itemId`);
    const to = resolveLocation(m.to, `itemMoves[${i}].to`);
    if (!item || !to) return;
    if (m.ownerId === undefined) { commits.push({ type: 'item.move', itemId: item, to }); return; }
    const ownerId = m.ownerId === null ? null : ent(m.ownerId, `itemMoves[${i}].ownerId`);
    commits.push({ type: 'item.move', itemId: item, to, ownerId });
  });
  x.quantityChanges.forEach((q, i) => {
    const item = ent(q.itemId, `quantityChanges[${i}].itemId`);
    if (!item) return;
    if (q.delta === 0) { issue(`quantityChanges[${i}].delta`, 'a quantity change cannot be 0'); return; }
    const e = ctx.entities[item];
    const current = e?.kind === 'item' ? e.quantity : (x.newEntities.find((n) => newIds[n.ref] === item && n.kind === 'item') as { quantity?: number } | undefined)?.quantity ?? 1;
    const next = current + q.delta;
    if (next < 0) { issue(`quantityChanges[${i}].delta`, `only ${current} left`); return; }
    commits.push({ type: 'item.quantity', itemId: item, quantity: next });
  });

  // 3. Observations, with knowledge granted to witnesses by the engine (CON-071).
  // A witness must be at the observation's place: there at the start, arriving, or introduced there (MEM-011).
  const mayWitnessAt = (placeId: string): Set<string> => new Set([
    ...Object.values(ctx.entities).filter((e) => (e.kind === 'pc' || e.kind === 'npc') && e.lifeState === 'alive' && e.locationId === placeId).map((e) => e.id),
    ...[...movedTo].filter(([, to]) => to === placeId).map(([c]) => c),
    ...x.newEntities.filter((n) => n.kind === 'npc' && n.locationId !== null && (n.locationId === placeId || newIds[n.locationId] === placeId)).map((n) => newIds[n.ref] as string),
  ]);
  const obsIds: Record<string, string> = {};
  x.observations.forEach((o) => { obsIds[o.ref] = ctx.newUuid(); });
  const obsRef = (r: string, path: string): string | null => {
    const id = r.startsWith('#') ? ctx.handles[r] : obsIds[r];
    if (!id) issue(path, `${r} does not refer to an observation`);
    return id ?? null;
  };
  x.observations.forEach((o, i) => {
    const p = `observations[${i}]`;
    if ((o.kind === 'claim') !== (o.claim !== undefined)) issue(p, 'kind "claim" and the claim field go together');
    const actorIds = o.actorIds.map((a, j) => ent(a, `${p}.actorIds[${j}]`)).filter((v): v is string => !!v);
    const witnessIds = [...new Set(o.witnessIds.map((w, j) => ent(w, `${p}.witnessIds[${j}]`)).filter((v): v is string => !!v))];
    const mentionedIds = o.mentionedIds.map((m, j) => ent(m, `${p}.mentionedIds[${j}]`)).filter((v): v is string => !!v);
    const placeId = o.placeId === null ? ctx.scenePlaceId : ent(o.placeId, `${p}.placeId`);
    if (placeId) {
      const here = mayWitnessAt(placeId);
      for (const w of witnessIds) if (!here.has(w)) issue(`${p}.witnessIds`, `${w} was not at ${placeId}; they can only learn of this by being told`);
    }
    if (offscreen) {
      if (actorIds.includes(ctx.pcId)) issue(`${p}.actorIds`, 'the PC acts only through the player');
      if (witnessIds.includes(ctx.pcId) && !opts.pcMayWitness) issue(`${p}.witnessIds`, 'the PC is on-screen; things happening to the PC are narrated, not simulated');
      if (o.claim?.sourceId === ctx.pcId) issue(`${p}.claim.sourceId`, 'the PC speaks only through the player');
      if (o.claim?.audienceIds.includes(ctx.pcId) && !opts.pcMayWitness) issue(`${p}.claim.audienceIds`, 'the PC can receive news off-screen only during a time skip');
    }
    const id = obsIds[o.ref] as string;
    let claim: Observation['claim'];
    if (o.claim) {
      const sourceId = ent(o.claim.sourceId, `${p}.claim.sourceId`);
      const audienceIds = o.claim.audienceIds.map((a, j) => ent(a, `${p}.claim.audienceIds[${j}]`)).filter((v): v is string => !!v);
      const about = o.claim.about === null ? null : obsRef(o.claim.about, `${p}.claim.about`);
      if (sourceId) claim = { sourceId, audienceIds, content: o.claim.content, aboutObservationId: about, truthful: o.claim.truthful };
    }
    const gameTime = opts.observationTime ? opts.observationTime(i) : ctx.gameTime;
    commits.push({ type: 'observation.add', observation: { id, turnId: ctx.turnId, gameTime, placeId,
      kind: o.kind, text: o.text, actorIds, witnessIds, mentionedIds, importance: o.importance, tags: o.tags, ...(claim ? { claim } : {}) } });
    const grant = (entityId: string, via: KnowledgeGrant['via']): CommitPayload =>
      ({ type: 'knowledge.grant', grant: { entityId, observationId: id, via, viaObservationId: null, gameTime } });
    for (const w of witnessIds) commits.push(grant(w, 'witnessed'));
    // An absent audience (a letter, a message) still learns the claim, never the truth behind it (MEM-034).
    for (const a of claim?.audienceIds ?? []) if (!witnessIds.includes(a)) commits.push(grant(a, 'told'));
  });

  x.namesLearned.forEach((nl, i) => {
    const knower = ent(nl.knowerId, `namesLearned[${i}].knowerId`), target = ent(nl.entityId, `namesLearned[${i}].entityId`);
    if (!knower || !target) return;
    if (!isCharacter(knower)) issue(`namesLearned[${i}].knowerId`, `${knower} is not a character`);
    commits.push({ type: 'knowledge.name', knowerId: knower, entityId: target, name: nl.name });
  });

  // 4. Relationships: never from the PC (MEM-063).
  x.relationshipChanges.forEach((r, i) => {
    const p = `relationshipChanges[${i}]`;
    const from = ent(r.fromId, `${p}.fromId`), to = ent(r.toId, `${p}.toId`);
    if (!from || !to) return;
    if (from === ctx.pcId && offscreen) { issue(`${p}.fromId`, 'the PC\'s feelings never change off-screen'); return; }
    if (from === ctx.pcId && ctx.ruleset.relationships.trackPc === 'off') {
      issue(`${p}.fromId`, 'the PC\'s feelings belong to the player in this campaign; record how others feel about the PC instead');
      return;
    }
    if (!isCharacter(from)) issue(`${p}.fromId`, `${from} is not a character`);
    if (from === to) issue(p, 'a character has no relationship with themself');
    const key = r.keyObservationRef === null ? null : obsRef(r.keyObservationRef, `${p}.keyObservationRef`);
    commits.push({ type: 'relationship.adjust', fromId: from, toId: to, deltas: r.deltas, summary: r.summary, addKeyObservationIds: key ? [key] : [] });
  });

  // 5. Wiki patches.
  x.wikiPatches.forEach((w, i) => {
    const id = ent(w.entityId, `wikiPatches[${i}].entityId`);
    if (!id) return;
    if (w.op === 'remove') { commits.push({ type: 'wiki.patch', entityId: id, op: { op: 'remove-section', heading: w.heading } }); return; }
    const sources = w.sourceRefs.map((r, j) => obsRef(r, `wikiPatches[${i}].sourceRefs[${j}]`)).filter((v): v is string => !!v);
    commits.push({ type: 'wiki.patch', entityId: id, op: { op: 'upsert-section', heading: w.heading, body: w.body, sourceObservationIds: sources } });
  });

  // 6. Statuses and clocks, only when the ruleset makes them narrative (RUL-140).
  x.statusChanges.forEach((s, i) => {
    const c = ent(s.characterId, `statusChanges[${i}].characterId`);
    if (!c) return;
    if (s.op === 'add') {
      if ((s.kind === 'harm') !== (s.level !== null)) issue(`statusChanges[${i}]`, 'harm needs a level; conditions have none');
      commits.push({ type: 'status.add', characterId: c, status: { id: ctx.newUuid(), name: s.name, kind: s.kind,
        ...(s.level !== null ? { level: s.level } : {}), tags: s.tags, permanent: false, treated: false, inflictedAt: ctx.gameTime, changedAt: ctx.gameTime } });
    } else {
      const ids = ctx.statusIdsByName(c, s.statusName);
      if (ids.length !== 1) { issue(`statusChanges[${i}].statusName`, ids.length ? `"${s.statusName}" matches ${ids.length} statuses; use a unique name` : `${c} has no status "${s.statusName}"`); return; }
      commits.push({ type: 'status.remove', characterId: c, statusId: ids[0] as string, reason: 'extraction' });
    }
  });
  x.clockChanges.forEach((c) => commits.push({ type: 'clock.tick', clockId: c.clockId, ticks: c.ticks }));

  return { commits, issues };
}

// ===================================================================== retrieval scoring (MEM §6)

export type Weights = { importance: number; recency: number; relevance: number; entities: number; pc: number };
export type Candidate = {
  observation: Observation; via: KnowledgeGrant['via']; cosine: number | null; involvesPc: boolean;
};

export function scoreCandidate(c: Candidate, now: number, focus: Set<string>, w: Weights, halfLifeDays: number) {
  const ageDays = Math.max(0, now - c.observation.gameTime) / 1440;
  const o = c.observation;
  const parts = {
    importance: w.importance * (o.importance / 10),
    recency: w.recency * 0.5 ** (ageDays / halfLifeDays),
    relevance: w.relevance * Math.max(0, c.cosine ?? 0),
    entities: w.entities * ([...o.actorIds, ...o.witnessIds, ...o.mentionedIds, ...(o.claim ? [o.claim.sourceId] : [])].some((id) => focus.has(id)) ? 1 : 0),
    pc: w.pc * (c.involvesPc ? 1 : 0),
  };
  return { score: parts.importance + parts.recency + parts.relevance + parts.entities + parts.pc, parts };
}

export function renderForKnower(o: Observation, names: (id: string) => string, via?: KnowledgeGrant['via']): string {
  if (!o.claim) return o.text;
  if (via === 'rumor') return `Word has it that ${o.claim.content} (the story started with ${names(o.claim.sourceId)})`;
  return `${names(o.claim.sourceId)} told ${o.claim.audienceIds.map(names).join(' and ')} that ${o.claim.content}`;
}

export function selectMemories(args: {
  knowerId: string; candidates: Candidate[]; now: number; focus: Set<string>; weights: Weights; halfLifeDays: number;
  pinnedRecent: number; keyObservationIds: Set<string>; tokenBudget: number; tokens(text: string): number; names(id: string): string;
}): RetrievedObservation[] {
  // Consolidated observations give way to the summary that replaced them (MEM-106).
  const summarized = new Set(args.candidates.flatMap((c) => c.observation.summarizesIds ?? []));
  const pool = args.candidates.filter((c) => !summarized.has(c.observation.id));
  const chosen = new Map<string, RetrievedObservation>();
  let used = 0;
  const take = (c: Candidate, reason: RetrievedObservation['reason']) => {
    if (chosen.has(c.observation.id)) return true;
    const text = renderForKnower(c.observation, args.names, c.via);
    const cost = args.tokens(text);
    if (used + cost > args.tokenBudget) return false;
    used += cost;
    const { score, parts } = scoreCandidate(c, args.now, args.focus, args.weights, args.halfLifeDays);
    chosen.set(c.observation.id, { observationId: c.observation.id, knowerId: args.knowerId, text, gameTime: c.observation.gameTime,
      via: c.via, importance: c.observation.importance, reason, score, scoreParts: parts });
    return true;
  };
  const recent = pool.filter((c) => c.involvesPc).sort((a, b) => b.observation.gameTime - a.observation.gameTime).slice(0, args.pinnedRecent);
  for (const c of recent) take(c, 'pinned-recent');
  for (const c of pool.filter((c) => args.keyObservationIds.has(c.observation.id))) take(c, 'pinned-key');
  const ranked = pool.map((c) => ({ c, s: scoreCandidate(c, args.now, args.focus, args.weights, args.halfLifeDays).score })).sort((a, b) => b.s - a.s);
  for (const { c } of ranked) take(c, 'scored'); // a memory that doesn't fit is skipped; smaller ones may still fit (MEM-075)
  return [...chosen.values()].sort((a, b) => a.gameTime - b.gameTime); // chronological for the prompt
}

// ===================================================================== consolidation (MEM §8)

export type ConsolidationParams = { afterDays: number; maxImportance: number; minGroupSize: number };
/**
 * Groups old, minor observations that exactly the same characters know, by place and game
 * week. A summary is only ever granted to that same set, so it cannot leak (MEM-103).
 */
export function consolidationGroups(obs: Observation[], knowers: (id: string) => string[], now: number, p: ConsolidationParams) {
  const summarized = new Set(obs.flatMap((o) => o.summarizesIds ?? []));
  const groups = new Map<string, { knowerIds: string[]; observations: Observation[] }>();
  for (const o of obs) {
    if (o.kind === 'summary' || summarized.has(o.id) || o.importance > p.maxImportance) continue;
    if ((now - o.gameTime) / 1440 < p.afterDays) continue;
    const k = [...new Set(knowers(o.id))].sort();
    if (k.length === 0) continue;
    const key = `${k.join(',')}|${o.placeId ?? '-'}|${Math.floor(o.gameTime / (7 * 1440))}`;
    const g = groups.get(key) ?? { knowerIds: k, observations: [] };
    g.observations.push(o);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.observations.length >= p.minGroupSize);
}
