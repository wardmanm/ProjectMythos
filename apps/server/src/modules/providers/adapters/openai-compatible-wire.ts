// The wire format of OpenAI's Chat Completions API, as the OpenAI-compatible adapter
// sends and reads it (PRV-012, PRV-030). LM Studio, llama.cpp's server, vLLM, and
// OpenRouter all speak it, each with a few fields of their own. The providers README
// links the API reference this follows.
import { z } from 'zod';

/** The `/chat/completions` request body. Fields left undefined are left out of the JSON. */
export type ChatBody = {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  stream: boolean;
  stream_options?: { include_usage: true };
  temperature: number | undefined;
  top_p: number | undefined;
  presence_penalty: number | undefined;
  /** Not OpenAI's own: llama.cpp, vLLM, and LM Studio read it. */
  top_k: number | undefined;
  /** Not OpenAI's own: llama.cpp, vLLM, and LM Studio read it. */
  repeat_penalty: number | undefined;
  response_format?: {
    type: 'json_schema';
    json_schema: { name: string; schema: Record<string, unknown>; strict: true };
  };
  tools?: { type: 'function'; function: { name: string; parameters: Record<string, unknown> } }[];
  tool_choice?: { type: 'function'; function: { name: string } };
};

/** `prompt_tokens` is the whole prompt; `cached_tokens` is the cached part of it. */
const UsageSchema = z.object({
  prompt_tokens: z.int().nonnegative(),
  completion_tokens: z.int().nonnegative(),
  prompt_tokens_details: z.object({ cached_tokens: z.int().nonnegative().nullish() }).nullish(),
});
export type Usage = z.infer<typeof UsageSchema>;

/** A tool call, or a piece of one in a stream. `arguments` is a string of JSON. */
const ToolCallSchema = z.object({
  index: z.int().optional(),
  function: z.object({ arguments: z.string().nullish() }).optional(),
});

/**
 * The fields a message, or a streamed delta of one, may carry. Reasoning arrives as
 * `reasoning_content` (llama.cpp, vLLM, DeepSeek) or `reasoning` (OpenRouter, newer vLLM);
 * either in another shape is ignored rather than failing the reply.
 */
const MessageSchema = z.object({
  content: z.string().nullish(),
  refusal: z.string().nullish(),
  tool_calls: z.array(ToolCallSchema).nullish(),
  reasoning_content: z.string().nullish().catch(null),
  reasoning: z.string().nullish().catch(null),
});
export type WireMessage = z.infer<typeof MessageSchema>;

/** A reply that was not streamed. A server may report a failure in `error`, with a 200. */
export const CompletionSchema = z.object({
  choices: z
    .array(z.object({ message: MessageSchema, finish_reason: z.string().nullish() }))
    .default([]),
  usage: UsageSchema.nullish(),
  error: z.unknown().optional(),
});

/**
 * One event's data in a streamed reply. The usage chunk, asked for with
 * `stream_options.include_usage`, has no choices.
 */
export const ChunkSchema = z.object({
  choices: z
    .array(z.object({ delta: MessageSchema.nullish(), finish_reason: z.string().nullish() }))
    .nullish(),
  usage: UsageSchema.nullish(),
  error: z.unknown().optional(),
});

/** `GET /models`. */
export const ModelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
