/*
 * Validates every fixture under spec/fixtures: schemas, file names, cross-references,
 * gear placement, history, relationships, and canon. Prints every problem found, then
 * exits non-zero if there were any. Usage: tsx scripts/check-fixtures.ts [fixturesDir]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import * as C from '@mythos/contracts/content';
import { MachineConfigSchema, WorkflowMappingSchema, type Character, type Item } from '@mythos/contracts';
import { calendarIssues, dateIssues, fromDate } from '../core/calendar';
import { rulesetIssues } from '../core/ruleset-check';
import { themeIssues } from '../core/theme';
import { validateItemMove } from '../core/gear';
import { mappingIssues, type ComfyWorkflow } from '../core/media';
import { cmp } from '../core/compare';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../fixtures/', import.meta.url)));
const problems: string[] = [];
const say = (file: string, message: string) => problems.push(`${relative(root, file).split('\\').join('/')}: ${message}`);

const jsonFiles = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort(cmp).map((f) => join(dir, f)) : [];

/** Parses a file with a schema; reports and returns null on failure. Checks `id` matches the file name (SCH-020). */
function load<S extends z.ZodType>(file: string, schema: S): z.infer<S> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    say(file, `not valid JSON (${(e as Error).message})`);
    return null;
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    for (const i of r.error.issues) say(file, `${i.path.join('.') || '(root)'}: ${i.message}`);
    return null;
  }
  const id = (r.data as { id?: unknown }).id;
  if (typeof id === 'string' && basename(file) !== `${id}.json` && basename(file) !== 'pack.json' && basename(file) !== 'setting.json') {
    say(file, `id "${id}" does not match the file name`);
  }
  return r.data;
}

function loadAll<S extends z.ZodType<{ id: string }>>(dir: string, schema: S): Map<string, z.infer<S>> {
  const out = new Map<string, z.infer<S>>();
  for (const f of jsonFiles(dir)) {
    const d = load(f, schema);
    if (d) out.set(d.id, d);
  }
  return out;
}

// ============================================================== library

const lib = join(root, 'library');
const libCalendars = loadAll(join(lib, 'calendars'), C.CalendarDefinitionSchema);
const libRulesets = loadAll(join(lib, 'rulesets'), C.RulesetSchema);
const libThemes = loadAll(join(lib, 'themes'), C.ThemeSchema);
const libSlots = loadAll(join(lib, 'slot-schemas'), C.SlotSchemaDefinitionSchema);
const libTones = loadAll(join(lib, 'tone-profiles'), C.ToneProfileSchema);

for (const [id, c] of libCalendars) for (const m of calendarIssues(c)) say(join(lib, 'calendars', `${id}.json`), m);
for (const [id, r] of libRulesets) for (const m of rulesetIssues(r)) say(join(lib, 'rulesets', `${id}.json`), m);
for (const [id, t] of libThemes) for (const m of themeIssues(t)) say(join(lib, 'themes', `${id}.json`), m);

function checkTone(file: string, t: C.ToneProfile, packThemes: Set<string>, slotIds: Set<string>) {
  if (t.themeId && !libThemes.has(t.themeId) && !packThemes.has(t.themeId)) say(file, `themeId "${t.themeId}" is not a known theme`);
  if (t.slotSchemaId && !slotIds.has(t.slotSchemaId)) say(file, `slotSchemaId "${t.slotSchemaId}" is not a known slot schema`);
}
for (const [id, t] of libTones) checkTone(join(lib, 'tone-profiles', `${id}.json`), t, new Set(), new Set(libSlots.keys()));

// ============================================================== test fixtures

const test = join(root, 'test');
for (const f of jsonFiles(join(test, 'calendars')).filter((f) => !f.endsWith('-truth.json'))) {
  const c = load(f, C.CalendarDefinitionSchema);
  if (c) for (const m of calendarIssues(c)) say(f, m);
}
load(join(test, 'machine-config.json'), MachineConfigSchema);
for (const mf of jsonFiles(join(test, 'workflows')).filter((f) => f.endsWith('.mapping.json'))) {
  const mapping = load(mf, WorkflowMappingSchema);
  const wf = mf.replace(/\.mapping\.json$/, '.api.json');
  if (!existsSync(wf)) say(mf, `no workflow ${basename(wf)} beside it`);
  else if (mapping) for (const m of mappingIssues(JSON.parse(readFileSync(wf, 'utf8')) as ComfyWorkflow, mapping)) say(mf, m);
}

// ============================================================== packs

for (const packId of existsSync(join(root, 'packs')) ? readdirSync(join(root, 'packs')).sort(cmp) : []) checkPack(join(root, 'packs', packId));

function checkPack(dir: string) {
  const at = (...p: string[]) => join(dir, ...p);
  const manifest = load(at('pack.json'), C.PackManifestSchema);
  if (manifest && manifest.id !== basename(dir)) say(at('pack.json'), `id "${manifest.id}" does not match the folder name`);
  const setting = load(at('setting.json'), C.SettingSchema);

  const calendars = new Map([...libCalendars, ...loadAll(at('calendars'), C.CalendarDefinitionSchema)]);
  const rulesets = new Map([...libRulesets, ...loadAll(at('rulesets'), C.RulesetSchema)]);
  const slotSchemas = new Map([...libSlots, ...loadAll(at('slot-schemas'), C.SlotSchemaDefinitionSchema)]);
  const packThemes = loadAll(at('themes'), C.ThemeSchema);
  const tones = new Map([...libTones, ...loadAll(at('tone-profiles'), C.ToneProfileSchema)]);
  const scenarios = loadAll(at('scenarios'), C.ScenarioSchema);
  for (const f of jsonFiles(at('tone-profiles'))) {
    const t = tones.get(basename(f, '.json'));
    if (t) checkTone(f, t, new Set(packThemes.keys()), new Set(slotSchemas.keys()));
  }
  for (const [id, t] of packThemes) for (const m of themeIssues(t)) say(at('themes', `${id}.json`), m);

  // ---- entities, by folder (SCH-022)
  const folders = { characters: ['pc', 'npc'], places: ['place'], factions: ['faction'], items: ['item'] } as const;
  const entities = new Map<string, C.AuthoredEntity>();
  const canon = new Map<string, string>();
  for (const [folder, kinds] of Object.entries(folders)) {
    for (const f of jsonFiles(at('entities', folder))) {
      const e = load(f, C.AuthoredEntitySchema);
      if (!e) continue;
      if (!(kinds as readonly string[]).includes(e.kind)) say(f, `kind "${e.kind}" does not belong in entities/${folder}`);
      if (entities.has(e.id)) say(f, `duplicate entity id "${e.id}"`);
      entities.set(e.id, e);
      const md = f.replace(/\.json$/, '.md');
      if (existsSync(md)) {
        const text = readFileSync(md, 'utf8');
        canon.set(e.id, text);
        const headings = text.match(/^##\s+Common knowledge\s*$/gim) ?? [];
        if (headings.length > 1) say(md, 'more than one "## Common knowledge" section');
      }
    }
  }
  const kindOf = (id: string) => entities.get(id)?.kind;
  const need = (file: string, path: string, id: string | null | undefined, kinds: string[]) => {
    if (id == null) return;
    const k = kindOf(id);
    if (!k) say(file, `${path}: "${id}" is not an entity in this pack`);
    else if (!kinds.includes(k)) say(file, `${path}: "${id}" is a ${k}, expected ${kinds.join(' or ')}`);
  };

  // Without a valid setting, keep going with what can still be checked (SCH-100).
  const sf = at('setting.json');
  const calendar = setting ? calendars.get(setting.calendarId) : undefined;
  const slots = setting ? slotSchemas.get(setting.slotSchemaId) : undefined;
  const rulesetId = setting?.defaults.rulesetId ?? 'ruleset.standard';
  const ruleset = rulesets.get(rulesetId);
  if (setting) {
    if (!calendar) say(sf, `calendarId "${setting.calendarId}" is not in the pack or the library`);
    if (!slots) say(sf, `slotSchemaId "${setting.slotSchemaId}" is not in the pack or the library`);
    if (!ruleset) say(sf, `defaults.rulesetId "${rulesetId}" is not in the pack or the library`);
    if (setting.defaults.toneProfileId && !tones.has(setting.defaults.toneProfileId)) say(sf, `defaults.toneProfileId "${setting.defaults.toneProfileId}" is not known`);
    for (const s of setting.scenarioIds) if (!scenarios.has(s)) say(sf, `scenarioIds: "${s}" has no file in scenarios/`);
    if (calendar) for (const m of dateIssues(calendar, setting.epoch)) say(sf, `epoch: ${m}`);
  }

  const dateCheck = (file: string, path: string, d: C.CalendarDate) => {
    if (!calendar || !setting) return;
    const issues = dateIssues(calendar, d);
    for (const m of issues) say(file, `${path}: ${m}`);
    if (!issues.length && fromDate(calendar, setting.epoch, d) < 0) say(file, `${path}: before the setting's epoch (SCH-070, SCH-091)`);
  };

  // ---- scenarios (SCH-070, SCH-071)
  for (const [id, s] of scenarios) {
    const f = at('scenarios', `${id}.json`);
    dateCheck(f, 'start', s.start);
    need(f, 'startPlaceId', s.startPlaceId, ['place']);
    s.presentEntityIds.forEach((e, i) => need(f, `presentEntityIds.${i}`, e, ['pc', 'npc']));
    if (s.pc.mode !== 'player-created') need(f, 'pc.characterId', s.pc.characterId, ['pc']);
    if (!existsSync(at(...s.openingFile.split('/')))) say(f, `openingFile "${s.openingFile}" does not exist`);
  }

  // ---- characters, places, factions
  const statIds = ruleset ? ruleset.stats.list.map((s) => s.id).sort(cmp) : [];
  for (const e of entities.values()) {
    const folder = e.kind === 'pc' || e.kind === 'npc' ? 'characters' : `${e.kind === 'faction' ? 'factions' : e.kind === 'place' ? 'places' : 'items'}`;
    const f = at('entities', folder, `${e.id}.json`);
    if (e.kind === 'pc' || e.kind === 'npc') {
      need(f, 'startingLocationId', e.startingLocationId, ['place']);
      if (!ruleset) continue;
      const keys = Object.keys(e.stats).sort(cmp);
      if (keys.join() !== statIds.join()) say(f, `stats: has ${keys.join(', ')}; ${ruleset.id} defines ${statIds.join(', ')} (SCH-114)`);
      for (const [k, v] of Object.entries(e.stats)) {
        if (v < ruleset.stats.min || v > ruleset.stats.max) say(f, `stats.${k}: ${v} is outside ${ruleset.stats.min}..${ruleset.stats.max}`);
      }
      if (e.kind === 'pc') {
        const p = ruleset.pcCreation;
        const total = Object.values(e.stats).reduce((a, v) => a + v, 0);
        // A premade PC meets pcCreation for the setting's default ruleset (SCH-072).
        if (total !== p.statPoints) say(f, `stats total ${total}; ${ruleset.id} gives a new PC ${p.statPoints}`);
        for (const [k, v] of Object.entries(e.stats)) {
          if (v < p.minStartingStat || v > p.maxStartingStat) say(f, `stats.${k}: ${v} is outside the starting range ${p.minStartingStat}..${p.maxStartingStat}`);
        }
      }
      for (const st of e.startingStatuses) {
        for (const t of st.tags) if (ruleset && !ruleset.harm.tags.some((h) => h.id === t)) say(f, `startingStatuses: unknown harm tag "${t}"`);
      }
    } else if (e.kind === 'place') {
      need(f, 'parentPlaceId', e.parentPlaceId, ['place']);
      const seen = new Set<string>([e.id]);
      for (let p = e.parentPlaceId; p; ) {
        if (seen.has(p)) { say(f, 'parentPlaceId: places form a cycle'); break; }
        seen.add(p);
        const parent = entities.get(p);
        p = parent?.kind === 'place' ? parent.parentPlaceId : null;
      }
    }
  }

  // ---- items (SCH-082): placed one by one, containers before their contents
  if (ruleset && slots) {
    const characters: Record<string, Character> = {};
    for (const e of entities.values()) {
      if (e.kind !== 'pc' && e.kind !== 'npc') continue;
      characters[e.id] = {
        id: e.id, name: e.name, aliases: e.aliases, tags: e.tags, kind: e.kind, ageCategory: e.ageCategory,
        stats: e.stats, statuses: [], physicalDescription: e.physicalDescription, personality: e.personality,
        goals: e.goals, keyNpc: e.keyNpc, locationId: e.startingLocationId, lifeState: 'alive',
      };
    }
    const pending: Item[] = [];
    for (const e of entities.values()) {
      if (e.kind !== 'item') continue;
      const f = at('entities', 'items', `${e.id}.json`);
      need(f, 'ownerId', e.ownerId, ['pc', 'npc', 'faction']);
      for (const s of [...(e.wearable?.slots ?? []), ...(e.wearable?.covers ?? [])]) {
        if (!slots.slots.some((x) => x.id === s)) say(f, `wearable: "${s}" is not a slot in ${slots.id}`);
      }
      for (const b of e.bonuses) if (b.type === 'roll' && b.stat && !statIds.includes(b.stat)) say(f, `bonuses: unknown stat "${b.stat}"`);
      if (/^(a|an|the) /i.test(e.name)) say(f, `name: "${e.name}" starts with an article (GEAR-065)`);
      const l = e.startingLocation;
      if ('characterId' in l) need(f, 'startingLocation.characterId', l.characterId, ['pc', 'npc']);
      if (l.type === 'placed') need(f, 'startingLocation.placeId', l.placeId, ['place']);
      if (l.type === 'contained') need(f, 'startingLocation.containerId', l.containerId, ['item']);
      pending.push({
        id: e.id, name: e.name, aliases: e.aliases, tags: e.tags, kind: 'item', description: e.description,
        location: l, ownerId: e.ownerId, quantity: e.quantity, bonuses: e.bonuses,
        ...(e.weight !== undefined ? { weight: e.weight } : {}), ...(e.size ? { size: e.size } : {}),
        ...(e.container ? { container: e.container } : {}),
        ...(e.wearable ? { wearable: { slots: e.wearable.slots, covers: e.wearable.covers } } : {}),
      });
    }
    const placed: Item[] = [];
    while (pending.length) {
      const i = pending.findIndex((it) => it.location.type !== 'contained' || placed.some((p) => p.location.type !== 'gone' && it.location.type === 'contained' && p.id === it.location.containerId));
      if (i < 0) {
        for (const it of pending) say(at('entities', 'items', `${it.id}.json`), 'startingLocation: its container is missing or forms a cycle');
        break;
      }
      const [it] = pending.splice(i, 1) as [Item];
      for (const g of validateItemMove(it, it.location, [...placed, it], characters, slots, ruleset)) say(at('entities', 'items', `${it.id}.json`), `startingLocation: ${g.message}`);
      placed.push(it);
    }
  }

  // ---- history (SCH-090, SCH-091)
  const hf = at('history.json');
  const history = existsSync(hf) ? load(hf, C.HistoryFileSchema) : null;
  if (history) {
    const refs = new Set<string>();
    history.entries.forEach((h, n) => {
      const p = `entries.${n} (${h.ref})`;
      if (refs.has(h.ref)) say(hf, `${p}: duplicate ref`);
      refs.add(h.ref);
      if (h.when) dateCheck(hf, `${p}.when`, h.when);
      need(hf, `${p}.placeId`, h.placeId, ['place']);
      h.actorIds.forEach((a, i) => need(hf, `${p}.actorIds.${i}`, a, ['pc', 'npc', 'faction']));
      h.witnessIds.forEach((w, i) => need(hf, `${p}.witnessIds.${i}`, w, ['pc', 'npc']));
      h.alsoKnownBy.forEach((k, i) => need(hf, `${p}.alsoKnownBy.${i}`, k.entityId, ['pc', 'npc']));
      if ((h.kind === 'claim') !== (h.claim !== undefined)) say(hf, `${p}: a claim entry needs "claim", and only claim entries have one`);
      if (h.claim) {
        need(hf, `${p}.claim.sourceId`, h.claim.sourceId, ['pc', 'npc']);
        h.claim.audienceIds.forEach((a, i) => need(hf, `${p}.claim.audienceIds.${i}`, a, ['pc', 'npc']));
      }
    });
    history.entries.forEach((h, n) => {
      if (h.claim?.aboutRef && !refs.has(h.claim.aboutRef)) say(hf, `entries.${n} (${h.ref}).claim.aboutRef: no entry "${h.claim.aboutRef}"`);
    });
  }

  // ---- relationships (SCH-092, CON-073)
  const rf = at('relationships.json');
  const rels = existsSync(rf) ? load(rf, C.RelationshipsFileSchema) : null;
  if (rels && ruleset) {
    const dims = new Set(ruleset.relationships.dimensions.map((d) => d.id));
    const pairs = new Set<string>();
    rels.relationships.forEach((r, n) => {
      const p = `relationships.${n}`;
      need(rf, `${p}.fromId`, r.fromId, ['pc', 'npc']);
      need(rf, `${p}.toId`, r.toId, ['pc', 'npc']);
      if (r.fromId === r.toId) say(rf, `${p}: fromId and toId are the same`);
      if (pairs.has(`${r.fromId}>${r.toId}`)) say(rf, `${p}: duplicate relationship ${r.fromId} → ${r.toId}`);
      pairs.add(`${r.fromId}>${r.toId}`);
      for (const [d, v] of Object.entries(r.dimensions)) {
        if (!dims.has(d)) say(rf, `${p}.dimensions.${d}: not a dimension in ${ruleset.id}`);
        else if (v < ruleset.relationships.min || v > ruleset.relationships.max) say(rf, `${p}.dimensions.${d}: ${v} is outside ${ruleset.relationships.min}..${ruleset.relationships.max}`);
      }
    });
  }
}

if (problems.length) {
  for (const p of problems) console.log(p);
  console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} in ${root}`);
  process.exit(1);
}
console.log(`All fixtures in ${root} are valid.`);
