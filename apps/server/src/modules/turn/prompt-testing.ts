// Helpers for the narrator-prompt tests only: the reference campaign created with seeded
// IDs and played on with stored turns, and the context builder over it with fake
// dependencies (CTX-110). Not exported from index.ts.
import {
  type CommitPayload,
  type CommitStage,
  err,
  type MachineConfig,
  type ModelProfile,
  ModelProfileSchema,
  ok,
  type ReadPoint,
} from '@mythos/contracts';
import type { ContentSources } from '../content';
import { type BuiltPrompt, type ContextDependencies, createContextBuilder } from '../context';
import { appendSet, type Database, insertTurn } from '../storage';
import { createCampaign } from './create-campaign';
import { arrivalCommand, type createTestSpace, TEST_NOW } from './testing';

export const createdAt = TEST_NOW.toISOString();

/** Machine config's `context` defaults. */
const CONTEXT_SETTINGS: MachineConfig['context'] = {
  npcVoice: 'key',
  maxVoicedNpcsPerTurn: 2,
  keySecretImportance: 7,
  previousSceneSummaries: 3,
  oocTurnsKept: 3,
  transcriptChunkTurns: 8,
};

export function profileWith(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return ModelProfileSchema.parse({
    id: 'qwen-local',
    providerId: 'ollama-local',
    model: 'qwen3.6:35b-a3b',
    kind: 'text',
    contextWindow: 32768,
    maxOutputTokens: 2048,
    structuredOutput: 'json-schema',
    ...overrides,
  });
}

export type DependencyOptions = {
  profile?: ModelProfile;
  profileDir?: string;
  notConfigured?: boolean;
};

/** What the composition root would pass, with fakes (CTX-110). */
function dependencies(options: DependencyOptions = {}): ContextDependencies {
  const profile = options.profile ?? profileWith();
  return {
    profileFor: () =>
      options.notConfigured === true
        ? err({ code: 'not_configured', message: 'No model profile is assigned to narrator.' })
        : ok({ profile, charsPerToken: 3.5 }),
    contextSettings: () => CONTEXT_SETTINGS,
    profileTemplateDir: () => options.profileDir ?? null,
  };
}

/** The opening narration and three turns of play, as P1-T19 will store them. */
export const OPENING =
  'Rain follows you down from the coach step. The Gull and Anchor is low and smoky, and ' +
  'the talk at the tables stops when the door bangs shut behind you. Behind the bar, a ' +
  'broad woman with grey hair pinned up anyhow sets down a jug and looks you over.';
export const TURNS = [
  {
    input: 'I shake the rain off my cloak and ask the innkeeper for a room.',
    narration:
      '"A room I have," she says, wiping her hands. "Two shillings the night, soup included, ' +
      'and you look like you need the soup." A fisherman by the fire laughs into his cup.',
  },
  {
    input: 'I put two shillings on the bar and ask if she knew a Jory Ashby.',
    narration:
      'Her hand stops on the coins. "Knew him," she says quietly. "Lodged here in August. ' +
      'Paid in advance, which is more than most." She glances toward the fire before she ' +
      'says more.',
  },
  {
    input: 'I lower my voice. "He was my brother. What happened to the Merrow\'s Luck?"',
    narration:
      '"Lost in the squall, they say." She pours you a bowl of stew without asking. "The ' +
      'harbor clerk posted the notice himself." Her eyes stay on the bowl.',
  },
];

/**
 * A campaign from *Arrival*, with its database and root turn, a context builder over it,
 * and ways to play on: narrate a turn, add a turn with its input, or edit a turn.
 */
export async function arrivalToPlay(
  space: ReturnType<typeof createTestSpace>,
  options: { dataDir?: string; sources?: ContentSources } = {},
) {
  const deps = space.deps(options);
  const result = await createCampaign(deps, arrivalCommand());
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const { campaignId, currentBranchId: branchId, headTurnId: rootTurnId } = result.value;
  const opened = deps.store.openCampaign(campaignId);
  if (!opened.ok) throw new Error('the new campaign would not open');
  const db: Database = opened.value;
  let headTurnId = rootTurnId;
  let depth = 0;

  const set = (turnId: string, stage: CommitStage, payloads: CommitPayload[]) => ({
    set: {
      id: deps.newId(),
      turnId,
      stage,
      origin: stage === 'narration' ? ('model' as const) : ('player' as const),
      supersedesSetId: null,
      basedOnSetIds: [],
      copiedFromSetId: null,
      schemaVersion: 1,
      createdAt,
    },
    commits: payloads.map((payload) => ({ id: deps.newId(), payload })),
  });

  return {
    db,
    rootTurnId,
    builder: (dependencyOptions: DependencyOptions = {}) =>
      createContextBuilder({
        dependencies: dependencies(dependencyOptions),
        store: deps.store,
        campaignId,
      }),
    /** The narration read point of `turnId` (TRN-060). */
    point: (turnId: string): ReadPoint => ({ branchId, turnId, beforeStage: 'narration' }),
    narrate(turnId: string, text: string) {
      appendSet(db, set(turnId, 'narration', [{ type: 'narration.set', text, complete: true }]));
    },
    /** A player edit on `turnId`, which later turns read. */
    edit(turnId: string, payloads: CommitPayload[]) {
      appendSet(db, set(turnId, 'player-edit', payloads));
    },
    /** Adds a turn with its input at the head and returns its ID. */
    act(input: string): string {
      const turnId = deps.newId();
      depth += 1;
      insertTurn(db, {
        branchId,
        turn: {
          id: turnId,
          parentTurnId: headTurnId,
          depth,
          status: 'narrating',
          gameTimeStart: 0,
          copiedFromTurnId: null,
          createdAt,
        },
        sets: [set(turnId, 'input', [{ type: 'input.set', mode: 'ic', text: input }])],
      });
      headTurnId = turnId;
      return turnId;
    },
  };
}

export type PlayableCampaign = Awaited<ReturnType<typeof arrivalToPlay>>;

/** The opening narrated and three turns played, the third's narration not yet written. */
export function playThreeTurns(campaign: PlayableCampaign): string[] {
  campaign.narrate(campaign.rootTurnId, OPENING);
  const turnIds: string[] = [];
  for (const [index, turn] of TURNS.entries()) {
    const turnId = campaign.act(turn.input);
    turnIds.push(turnId);
    if (index < TURNS.length - 1) campaign.narrate(turnId, turn.narration);
  }
  return turnIds;
}

/** The narrator prompt for `turnId`, or a thrown error. */
export async function narratorPrompt(
  campaign: PlayableCampaign,
  turnId: string,
  options: DependencyOptions = {},
): Promise<BuiltPrompt> {
  const builder = campaign.builder(options);
  const built = await builder.narration(campaign.point(turnId), turnId, [], null);
  if (!built.ok) throw new Error(built.error.message);
  return built.value;
}

/** A prompt's messages, joined. */
export const textOf = (prompt: BuiltPrompt) =>
  prompt.messages.map((message) => message.content).join('\n\n');

/** How many times `part` appears in `text`. */
export const count = (text: string, part: string) => text.split(part).length - 1;
