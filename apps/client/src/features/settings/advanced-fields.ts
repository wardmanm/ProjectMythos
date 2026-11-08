// The Advanced section's fields (UI-088): machine config's `context`, `world`, `memory`,
// `queue`, and `retention`, as a table of paths into the config. Each field's default is
// read from the schema (`schemaDefaults`), never written here.
import type { Choice } from './form-fields';
import { isRecord } from './settings-draft';

type FieldBase = { path: readonly string[]; label: string; hint?: string };

export type AdvancedField =
  | (FieldBase & { kind: 'number' })
  /** A number, or null when left blank. */
  | (FieldBase & { kind: 'number-or-null'; blankMeans: string })
  | (FieldBase & { kind: 'switch' })
  | (FieldBase & { kind: 'choice'; choices: readonly Choice[] });

export type AdvancedGroup = { title: string; description: string; fields: AdvancedField[] };

const context: AdvancedGroup = {
  title: 'Prompts',
  description: 'How prompts are put together.',
  fields: [
    {
      path: ['context', 'npcVoice'],
      label: 'NPC voices',
      kind: 'choice',
      choices: [
        { value: 'shared', label: 'The narrator voices everyone' },
        { value: 'key', label: 'Key NPCs get calls of their own' },
        { value: 'strict', label: 'Every speaking NPC gets a call of its own' },
      ],
    },
    {
      path: ['context', 'maxVoicedNpcsPerTurn'],
      label: 'Most NPCs voiced in a turn',
      kind: 'number',
    },
    {
      path: ['context', 'keySecretImportance'],
      label: 'Importance that makes a secret key',
      hint: 'An NPC holding a relevant secret this important is voiced on its own.',
      kind: 'number',
    },
    {
      path: ['context', 'previousSceneSummaries'],
      label: 'Earlier scenes summed up',
      kind: 'number',
    },
    { path: ['context', 'oocTurnsKept'], label: 'Out-of-character turns kept', kind: 'number' },
    {
      path: ['context', 'transcriptChunkTurns'],
      label: 'Turns in a transcript chunk',
      kind: 'number',
    },
  ],
};

const world: AdvancedGroup = {
  title: 'The world off-screen',
  description: 'Limits on simulating NPCs between scenes. Lower them on slow hardware.',
  fields: [
    { path: ['world', 'enabled'], label: 'Simulate the world off-screen', kind: 'switch' },
    {
      path: ['world', 'maxFineTicks'],
      label: 'Most fine ticks in a skip',
      hint: 'A skip that crosses more tick boundaries runs coarse ticks instead.',
      kind: 'number',
    },
    { path: ['world', 'maxCoarsePeriods'], label: 'Most coarse periods in a skip', kind: 'number' },
    { path: ['world', 'maxActorsPerTick'], label: 'Most actors in a tick', kind: 'number' },
    { path: ['world', 'actorsPerCall'], label: 'Actors per model call', kind: 'number' },
    {
      path: ['world', 'recentInvolvementDays'],
      label: 'Game days an NPC stays recently involved',
      kind: 'number',
    },
  ],
};

const weight = (name: string, label: string): AdvancedField => ({
  path: ['memory', 'weights', name],
  label: `Retrieval weight: ${label}`,
  kind: 'number',
});

const memory: AdvancedGroup = {
  title: 'Memory',
  description: 'How memories are chosen for prompts, and how old ones are summed up.',
  fields: [
    weight('importance', 'importance'),
    weight('recency', 'recency'),
    weight('relevance', 'relevance'),
    weight('entities', 'entities in the scene'),
    weight('pc', 'the player character'),
    {
      path: ['memory', 'recencyHalfLifeDays'],
      label: 'Recency half-life, in game days',
      kind: 'number',
    },
    { path: ['memory', 'pinnedRecent'], label: 'Recent moments always included', kind: 'number' },
    {
      path: ['memory', 'consolidation', 'enabled'],
      label: 'Consolidate old observations',
      kind: 'switch',
    },
    {
      path: ['memory', 'consolidation', 'afterDays'],
      label: 'Consolidate after this many game days',
      kind: 'number',
    },
    {
      path: ['memory', 'consolidation', 'maxImportance'],
      label: 'Highest importance consolidated',
      kind: 'number',
    },
    {
      path: ['memory', 'consolidation', 'minGroupSize'],
      label: 'Fewest observations in a group',
      kind: 'number',
    },
    {
      path: ['memory', 'consolidation', 'everyTurns'],
      label: 'Consolidate every this many turns',
      kind: 'number',
    },
  ],
};

const queue: AdvancedGroup = {
  title: 'Job queue',
  description: 'How model jobs wait and retry.',
  fields: [
    {
      path: ['queue', 'preemptBackground'],
      label: 'Pause background jobs for play',
      kind: 'switch',
    },
    { path: ['queue', 'maxAttempts'], label: 'Tries per job', kind: 'number' },
  ],
};

const retention: AdvancedGroup = {
  title: 'Records',
  description: 'How long the inspector keeps what was sent to each model.',
  fields: [
    {
      path: ['retention', 'modelCallRecordDays'],
      label: 'Days to keep model call records',
      kind: 'number-or-null',
      blankMeans: 'Leave it blank to keep them forever.',
    },
  ],
};

export const advancedGroups: AdvancedGroup[] = [context, world, memory, queue, retention];

/** The value at `path`, or undefined when there is none. */
export function valueAt(source: unknown, path: readonly string[]): unknown {
  let node = source;
  for (const part of path) node = isRecord(node) ? node[part] : undefined;
  return node;
}

/** A copy of `target` with `value` at `path`. A path to nowhere changes nothing. */
export function withValueAt<T>(target: T, path: readonly string[], value: unknown): T {
  const copy = structuredClone(target);
  let node: unknown = copy;
  for (const part of path.slice(0, -1)) node = isRecord(node) ? node[part] : undefined;
  const last = path.at(-1);
  if (isRecord(node) && last !== undefined) node[last] = value;
  return copy;
}

/** A default in words: on or off, a choice's label, a number, or what null means. */
export function defaultWords(field: AdvancedField, value: unknown): string {
  if (field.kind === 'switch') return value === true ? 'on' : 'off';
  if (field.kind === 'choice') {
    return field.choices.find((choice) => choice.value === value)?.label ?? '';
  }
  if (value === null) return 'none';
  return typeof value === 'number' ? String(value) : '';
}
