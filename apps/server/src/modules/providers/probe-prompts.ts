// What the settings probe sends (PRV-090): one tiny structured request, the same for each
// structured-output method, and one text prompt of about 1,000 tokens, long enough that
// prompt processing takes measurable time. Every prompt is the narrator's, so it ends its
// instructions with the hard floor (CSET-040). Both prompts are written for the probe
// alone and belong to no campaign.
import type { ChatMessage } from '@mythos/contracts';
import { appendLocked } from '@mythos/core';
import { z } from 'zod';

/** The structured request's `schemaName`, and its key in the mock's placeholders. */
export const PROBE_SCHEMA_NAME = 'probe';

/** The tiny structured answer. Its root is an object, as every model-facing schema's is. */
export const ProbeAnswerSchema = z.strictObject({
  inn: z.string().min(1).max(60),
  rooms: z.int().min(1).max(40),
});

const STRUCTURED_INSTRUCTIONS =
  "You are helping to test a model's settings for a text roleplaying game. Answer briefly.";

/** The structured request's messages, before its method's format instruction is added. */
export function structuredProbeMessages(): ChatMessage[] {
  return [
    { role: 'system', content: appendLocked(STRUCTURED_INSTRUCTIONS, 'narrator') },
    {
      role: 'user',
      content:
        'Invent a name for an inn on a cold northern harbour, and say how many rooms it has to let.',
    },
  ];
}

/**
 * The text request's messages. They open with the probe's start time, so a server that
 * caches prompts cannot reuse an earlier probe's prompt and make prompt processing look
 * instant.
 */
export function textProbeMessages(startedAt: number): ChatMessage[] {
  const opening = `Settings probe, ${new Date(startedAt).toISOString()}.`;
  return [
    { role: 'system', content: appendLocked(`${opening}\n\n${TEXT_INSTRUCTIONS}`, 'narrator') },
    { role: 'user', content: SCENE_NOTES },
  ];
}

const TEXT_INSTRUCTIONS = [
  'You are the narrator of a single-player text roleplaying game. The engine has already',
  'decided what happens; your part is to tell it well. Write in the second person and the',
  'present tense, as if speaking to the player. Keep to what the scene notes establish,',
  'and add only small, concrete details that fit them: a sound, a smell, the way light',
  'falls. Never decide what the player character thinks, says, or does next. Write',
  'narration only, with no headings, lists, or notes to the player.',
].join(' ');

const SCENE_NOTES = [
  "These scene notes are for a test of the model's settings, not part of any campaign.",
  [
    'The town. Gullhaven is a fishing town on a cold northern coast, built in terraces up a',
    'steep hill above a stone harbour. Its houses are tarred timber on granite footings,',
    'painted in the faded reds and greens that the salt wind leaves behind. A single road',
    'winds down from the moors to the quay, and for most of the year the ferry from the',
    'mainland is the quicker way in. The town lives on herring, on the cooperage that',
    'barrels it, and on the few travellers who come for the cliffs.',
  ].join(' '),
  [
    'The hour and the weather. It is late afternoon in early autumn. A sea fog came in with',
    'the tide and hangs at the height of the rooftops, so the upper town is hidden and the',
    'lamps along the harbour wall were lit early. The air smells of brine, coal smoke, and',
    'the fish oil the coopers use to seal their barrels. Gulls stand in a row along the',
    'ridge of the fish market, silent for once. The water in the harbour is flat and grey,',
    'and every sound carries across it.',
  ].join(' '),
  [
    'The quay. Three fishing boats are tied up and unloading, their crews passing baskets',
    'hand to hand up a wooden ladder. A cart waits at the top with a patient brown horse,',
    'its driver asleep under a sack. An old man sells hot chestnuts from a brazier by the',
    "harbourmaster's office, and the smoke from it drifts low over the stones. Coils of",
    'rope, stacked creels, and a broken oar lie wherever the last tide left them. Halfway',
    'along the wall, an iron bell hangs from a post, green with age; nobody has rung it in',
    'years.',
  ].join(' '),
  [
    'The people. Elsa Varg, the harbourmaster, is a broad woman in her sixties with a',
    'ledger under one arm and a pencil behind her ear. She is fair, unhurried, and',
    'suspicious of anyone from the mainland who arrives with papers. Tobin Reed, the',
    'ferryman, is talkative and proud of his boat, the Kittiwake; he has already told the',
    'passengers twice that he has never lost a crossing. A stranger in a long grey coat',
    'stands apart at the end of the quay, watching the ferry come in and making no move to',
    'meet it.',
  ].join(' '),
  [
    "The player character. Ash Morrow is a travelling cartographer sent by the mainland's",
    'admiralty to survey this stretch of coast. Ash carries a leather tube of charts, a',
    'brass compass, and a letter of introduction addressed to the harbourmaster. Ash has',
    'never been to Gullhaven, knows nobody here, and has heard only that the town keeps to',
    'itself.',
  ].join(' '),
  [
    'What has happened lately. Two weeks ago a storm took the roof off the net loft, and',
    'the town has been mending it in the evenings, a few planks at a time. The herring came',
    'late this year and in smaller shoals, and the price of salt has risen twice since',
    'midsummer. Last week the keeper of the lighthouse on the point sent word that his lamp',
    'had gone out for an hour one night, though the weather was calm and the oil was full.',
    'Nobody has said so aloud, but the town has been waiting for someone from the mainland',
    'to come asking questions.',
  ].join(' '),
  [
    'The tone. Quiet unease and small kindnesses. Nothing violent happens in this scene.',
    'Let the fog, the silence of the gulls, and the stranger carry the mood without',
    'explaining them.',
  ].join(' '),
  [
    'Your task. Narrate the moment the Kittiwake bumps against the quay and Ash steps',
    'ashore, in about 120 words. End on a detail that invites the player to act.',
  ].join(' '),
].join('\n\n');
