import type { z } from 'zod';
import type {
  AppError,
  ChatMessage,
  ModelCallRecord,
  ModelRole,
  Result,
  SemanticIssue,
} from '@mythos/contracts';
import type { JobContext } from './queue';
import type { TextResponse } from './types';

/** The prompt's tiers, memories, and templates, recorded with the call (CTX-090). */
export type PromptReport = Pick<ModelCallRecord, 'tiers' | 'retrieved' | 'templates'>;

export type StructuredCallOptions<T> = {
  role: ModelRole;
  schemaName: string; // e.g. "ruling", "extraction"
  schema: z.ZodType<T>;
  messages: ChatMessage[];
  report: PromptReport;
  /** Runs after schema validation. Returning issues triggers a retry with them fed back. */
  semanticCheck?: (value: T) => SemanticIssue[];
  campaignId: string;
  turnId: string | null;
  signal: AbortSignal;
  /** The background job this call runs inside, or null to run as an interactive job (PRV-067). */
  job: JobContext | null;
};

/** Runs the full structured-output pipeline (PRV §5). Records every attempt (ARCH-060). */
export type CallStructured = <T>(options: StructuredCallOptions<T>) => Promise<Result<T, AppError>>;

export type StreamTextOptions = {
  role: ModelRole;
  messages: ChatMessage[];
  report: PromptReport;
  campaignId: string;
  turnId: string | null;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  /** The background job this call runs inside, or null to run as an interactive job (PRV-067). */
  job: JobContext | null;
};

/** Text that streamed. `finishReason` says whether it is complete (PRV-047, TRN-051). */
export type StreamedText = { text: string; finishReason: TextResponse['finishReason'] };

/** Streams plain text (narration, NPC voice). Records the call (ARCH-060). */
export type StreamText = (options: StreamTextOptions) => Promise<Result<StreamedText, AppError>>;
