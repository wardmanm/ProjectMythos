import type {
  AppError,
  ChatMessage,
  ModelProfile,
  ModelRole,
  ProviderConfig,
  ProviderHealth,
  Result,
  TokenUsage,
} from '@mythos/contracts';

export type ResponseFormat =
  { type: 'text' } | { type: 'json'; schemaName: string; jsonSchema: Record<string, unknown> };

export type TextRequest = {
  /** For logs and the mock adapter's fixture keys (PRV-081); real adapters ignore it. */
  role: ModelRole;
  profile: ModelProfile;
  messages: ChatMessage[];
  format: ResponseFormat;
  maxOutputTokens: number;
  sampling: ModelProfile['sampling'];
  signal: AbortSignal;
  /** Called with each text delta when streaming. Omit for non-streamed calls. */
  onDelta?: (delta: string) => void;
};

export type TextResponse = {
  text: string; // final answer text, thinking removed
  thinking: string | null; // captured reasoning, if the model produced any
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'cancelled' | 'refusal';
};

/** Provider failures map onto contract error codes (03-contracts §12). */
export type ProviderError = AppError & {
  code:
    | 'provider_unavailable'
    | 'provider_timeout'
    | 'provider_rejected'
    | 'rate_limited'
    | 'cancelled';
  retryable: boolean;
  httpStatus: number | null;
};

/** Every provider adapter implements this (ARCH-133). */
export type ProviderAdapter = {
  readonly config: ProviderConfig;
  health(signal: AbortSignal): Promise<ProviderHealth>;
  listModels(signal: AbortSignal): Promise<Result<string[], ProviderError>>;
  /** Present when the provider serves text models. */
  text?: {
    generate(req: TextRequest): Promise<Result<TextResponse, ProviderError>>;
  };
  /** Present when the provider serves embedding models. */
  embedding?: {
    embed(
      profile: ModelProfile,
      inputs: string[],
      signal: AbortSignal,
    ): Promise<Result<number[][], ProviderError>>;
  };
};
