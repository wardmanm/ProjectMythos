import type { Entity, Observation } from '@mythos/contracts';
import { commonKnowledge, displayName, knownEntityIds, visibleSections } from './journal';
import { eq } from '../test-support/harness';
const o = (id: string, extra: Partial<Observation>): Observation => ({ id, turnId: 't', gameTime: 0, placeId: 'place.gull-and-anchor', kind: 'event', text: '', actorIds: [], witnessIds: [], mentionedIds: [], importance: 3, tags: [], ...extra });
const pcKnows = [
  o('o1', { actorIds: ['pc.wren'], witnessIds: ['pc.wren', 'npc.varek', 'npc.odette'] }),
  o('o2', { kind: 'claim', actorIds: ['npc.varek'], witnessIds: ['pc.wren', 'npc.varek'], mentionedIds: ['npc.tomas'],
    claim: { sourceId: 'npc.varek', audienceIds: ['pc.wren'], content: 'Tomas skippered her', aboutObservationId: null, truthful: 'true' } }),
];
const known = knownEntityIds(pcKnows, 'pc.wren');
eq('known: the people she met, the place, and Tomas by mention; not the secret harbor', [...known].sort(), ['npc.odette', 'npc.tomas', 'npc.varek', 'pc.wren', 'place.gull-and-anchor']);
const varek = { id: 'npc.varek', kind: 'npc', name: 'Varek Holm', aliases: ['the clerk'] } as Entity;
eq('before introductions: a descriptor, never the true name', displayName(varek, 'pc.wren', []), 'the clerk');
eq('first impression recorded by extraction', displayName(varek, 'pc.wren', [{ entityId: 'npc.varek', name: 'the lean clerk' }]), 'the lean clerk');
eq('after he introduces himself', displayName(varek, 'pc.wren', [{ entityId: 'npc.varek', name: 'the lean clerk' }, { entityId: 'npc.varek', name: 'Varek' }]), 'Varek');
eq('places go by their name', displayName({ id: 'place.harbor', kind: 'place', name: 'Brinemoor Harbor', aliases: [] } as unknown as Entity, 'pc.wren', []), 'Brinemoor Harbor');
eq('a character always knows their own name', displayName(varek, 'npc.varek', []), 'Varek Holm');
const page = { entityId: 'npc.varek', canon: '', learned: [
  { heading: 'Disposition', body: 'Rattled by questions about the Merrow.', sourceObservationIds: ['o1'] },
  { heading: 'Secrets', body: 'Signed false papers.', sourceObservationIds: ['o1', 'secret'] },
  { heading: 'Unsourced', body: 'x', sourceObservationIds: [] }] };
eq('only sections resting entirely on what she knows', visibleSections(page, new Set(pcKnows.map((x) => x.id))).map((s) => s.heading), ['Disposition']);
const canon = 'Varek has clerked here for twelve years.\n\n## Common knowledge\n\nThe harbor clerk. Polite, dry, never late.\n\n## Secrets\n\nKeeps a second ledger.';
eq('common knowledge section only', commonKnowledge(canon), 'The harbor clerk. Polite, dry, never late.');
eq('no section, no common knowledge', commonKnowledge('Just canon.'), null);
