import { readFileSync } from 'node:fs';
import { ToneProfileSchema, type ContentSettings } from '@mythos/contracts/content';
import type { Entity } from '@mythos/contracts';
import { appendLocked, CATEGORIES, DEFAULT_WORDING, effectiveSettings, HARD_FLOOR, minorInvolved, renderContentSettings, usesExplicitRoles } from './content';
import { eq, fixturePath } from '../test-support/harness';
const tone = ToneProfileSchema.parse(JSON.parse(readFileSync(fixturePath('packs/reference/tone-profiles/tone.coastal-mystery.json'), 'utf8')));
const explicit: ContentSettings = { violence: 'explicit', gore: 'explicit', sexual: 'explicit', language: 'explicit', disturbing: 'explicit', lines: ['harm to children'], veils: ['torture'] };
const person = (id: string, kind: 'pc' | 'npc', ageCategory: 'adult' | 'minor'): Entity =>
  ({ id, kind, name: id, aliases: [], tags: [], ageCategory, stats: {}, statuses: [], physicalDescription: '', personality: '', goals: [], keyNpc: false, locationId: null, lifeState: 'alive' });
const ents = Object.fromEntries([person('pc.wren', 'pc', 'adult'), person('npc.odette', 'npc', 'adult'), person('npc.pip', 'npc', 'minor')].map((e) => [e.id, e]));

eq('every category has wording at every level', CATEGORIES.every((c) => Object.values(DEFAULT_WORDING[c]).every((w) => w.length > 20)), true);
eq('reference tone renders five lines plus its veil', renderContentSettings(tone.content).split('\n').length, 6);
eq('lines and veils render verbatim', renderContentSettings(explicit).split('\n').slice(5), [
  '- Never include, under any circumstances: harm to children.',
  '- These may happen in the story but only off-page, never described: torture.']);
eq('adults only: settings unchanged', effectiveSettings(explicit, minorInvolved(ents, ['pc.wren', 'npc.odette'])).sexual, 'explicit');
eq('a minor present: sexual forced off, everything else kept', effectiveSettings(explicit, minorInvolved(ents, ['pc.wren', 'npc.pip'])),
  { ...explicit, sexual: 'off' });
eq('explicit routing used for adults, never with a minor involved', [usesExplicitRoles(explicit, false), usesExplicitRoles(explicit, true)], [true, false]);
eq('no explicit category: normal routing', usesExplicitRoles(tone.content, false), false);
const narr = appendLocked('You are the narrator.\n\n- Sexual: anything goes.', 'narrator');
eq('floor appended last, after any template wording', narr.endsWith(HARD_FLOOR), true);
eq('every fiction and image role gets the floor; the embedder does not', ['adjudicator', 'narrator', 'npc-voice', 'extractor', 'consolidator', 'world-ticker', 'illustrator', 'embedder'].map((r) => appendLocked('x', r).includes(HARD_FLOOR)),
  [true, true, true, true, true, true, true, false]);
