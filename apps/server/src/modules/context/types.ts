import type {
  AppError,
  ChatMessage,
  EntityId,
  MachineConfig,
  ModelProfile,
  ModelRole,
  ReadPoint,
  Result,
  RetrievedObservation,
  TierReport,
  VoicedLines,
} from '@mythos/contracts';

export type BuiltPrompt = {
  role: ModelRole;
  messages: ChatMessage[];
  tiers: TierReport[];
  retrieved: RetrievedObservation[]; // every memory selected, for the inspector
  templates: string[]; // which template and partial files were used, with their layer
};

/** A key NPC chosen to be voiced separately this turn (CTX §6). */
export type KeySpeaker = {
  characterId: EntityId;
  why: 'flagged' | 'secret' | 'strict-mode';
};

/** A built prompt, or `context_overflow` (CTX-032) or `not_configured` (PRV-001). */
export type Built = Result<BuiltPrompt, AppError>;

/**
 * What the composition root passes to the context module (ARCH-022), so that it imports
 * neither `config` nor `providers` (ARCH-021, CTX-110).
 */
export type ContextDependencies = {
  /** The profile a role's call will use for this campaign, with its calibrated ratio (PRV-071). */
  profileFor(
    role: ModelRole,
    campaignId: string,
  ): Result<{ profile: ModelProfile; charsPerToken: number }, AppError>;
  /** Machine config's `context` section, read fresh for every prompt (PRV-004). */
  contextSettings(): MachineConfig['context'];
  /** The model-profile template folder (CTX-004, layer 2), or null if it does not exist. */
  profileTemplateDir(profileId: string): string | null;
};

/**
 * The context module's public API. Every builder reads at a read point (TRN-060) and
 * returns a complete prompt; the caller passes it to the providers module.
 */
export type ContextBuilder = {
  adjudication(point: ReadPoint, turnId: string, instruction: string | null): Promise<Built>;

  /** Decided before narration; the narrator then receives their lines (CTX-060). */
  keySpeakers(point: ReadPoint, turnId: string): Promise<KeySpeaker[]>;
  npcVoice(
    point: ReadPoint,
    turnId: string,
    speakerId: EntityId,
    earlier: VoicedLines[],
  ): Promise<Built>;
  narration(
    point: ReadPoint,
    turnId: string,
    voiced: VoicedLines[],
    instruction: string | null,
  ): Promise<Built>;

  /** Also returns the handle map for observations shown as `#n` (MEM-060). */
  extraction(
    point: ReadPoint,
    turnId: string,
  ): Promise<Result<{ prompt: BuiltPrompt; handles: Record<string, string> }, AppError>>;

  suggestions(point: ReadPoint, turnId: string): Promise<Built>;
  transcriptSummary(point: ReadPoint, turnIds: string[]): Promise<Built>;
  consolidation(
    point: ReadPoint,
    groupObservationIds: string[][],
    pageEntityIds: EntityId[],
  ): Promise<Built>;

  /** Renders a template against a campaign without calling a model (inspector preview). */
  preview(point: ReadPoint, templateName: string): Promise<Result<string, AppError>>;
};
