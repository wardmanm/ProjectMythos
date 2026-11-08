import type {
  ChatMessage,
  ModelCallAttempt,
  ModelCallRecord,
  ModelRole,
  Tier,
} from '@mythos/contracts';

/*
 * The inspector's words for what a model call record holds (UI-090). Plain and in
 * sentence case (UI-120); the inspector is the one place error codes may also appear
 * (UI-122).
 */

export const roleWords = {
  adjudicator: 'Adjudicator',
  narrator: 'Narrator',
  'npc-voice': 'NPC voice',
  extractor: 'Extractor',
  consolidator: 'Consolidator',
  'world-ticker': 'World ticker',
  embedder: 'Embedder',
  illustrator: 'Illustrator',
  'speech-segmenter': 'Speech segmenter',
} as const satisfies Record<ModelRole, string>;

export const outcomeWords = {
  success: 'Succeeded',
  fallback: 'Succeeded after falling back to prompt-only',
  failed: 'Failed',
  cancelled: 'Stopped',
} as const satisfies Record<ModelCallRecord['outcome'], string>;

export const methodWords = {
  'json-schema': 'JSON schema',
  'tool-call': 'Tool call',
  'prompt-only': 'Prompt only',
  text: 'Text',
} as const satisfies Record<ModelCallAttempt['method'], string>;

export const tierWords = {
  instructions: 'Instructions',
  world: 'World',
  scene: 'Scene',
  transcript: 'Transcript',
  state: 'State',
  knowledge: 'Knowledge',
  turn: 'Turn',
  task: 'Task',
} as const satisfies Record<Tier, string>;

export const messageRoleWords = {
  system: 'System message',
  user: 'User message',
  assistant: 'Assistant message',
} as const satisfies Record<ChatMessage['role'], string>;

const numbers = new Intl.NumberFormat('en-US');

/** A count with thousands separators: 1,204. */
export function count(value: number): string {
  return numbers.format(value);
}

/** A duration: "850 ms" under a second, "3.2 s" under a minute, then "2 min 5 s". */
export function duration(ms: number): string {
  if (ms < 1000) return `${String(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${String(Math.floor(seconds / 60))} min ${String(seconds % 60)} s`;
}

/** Tokens in and out, or "Not reported" when the provider gave neither. */
export function tokens(input: number | null, output: number | null): string {
  if (input === null && output === null) return 'Not reported';
  const words = (value: number | null) => (value === null ? 'not reported' : count(value));
  return `${words(input)} in · ${words(output)} out`;
}

/** A tier's estimate against its budget, e.g. "1,204 of 4,000 tokens, over budget". */
export function budgetWords(estimate: number, budget: number): string {
  const words = `${count(estimate)} of ${count(budget)} tokens`;
  return estimate > budget ? `${words}, over budget` : words;
}
