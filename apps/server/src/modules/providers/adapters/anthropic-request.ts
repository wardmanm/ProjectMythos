// Builds the body of one Anthropic Messages API request from a TextRequest: system
// blocks, merged messages with their cache breakpoints, the structured-output method, and
// the thinking setting. Pure, so the tests pin the exact request the adapter sends
// (PRV-042). Written against Anthropic's documentation as read on 2026-11-05.
import type { ChatMessage, ModelProfile } from '@mythos/contracts';
import { z } from 'zod';
import type { TextRequest } from '../types';

/** The API version every request sends, in the `anthropic-version` header (owner). */
export const ANTHROPIC_VERSION = '2026-10-21';

/** The most cache breakpoints Anthropic accepts in one request. */
export const MAX_CACHE_BREAKPOINTS = 4;

const CacheControlSchema = z.strictObject({ type: z.literal('ephemeral') });

const TextBlockSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  cache_control: CacheControlSchema.optional(),
});
type TextBlock = z.infer<typeof TextBlockSchema>;

const WireMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.array(TextBlockSchema).min(1),
});
type WireMessage = z.infer<typeof WireMessageSchema>;

const JsonSchemaSchema = z.record(z.string(), z.unknown());

/**
 * The body of `POST /v1/messages` as this adapter sends it. It never has `temperature`,
 * `top_p`, or `top_k`: version 2026-10-21 rejects them on every model (owner).
 */
export const MessagesRequestSchema = z.strictObject({
  model: z.string().min(1),
  max_tokens: z.int().positive(),
  stream: z.literal(true),
  system: z.array(TextBlockSchema).min(1).optional(),
  messages: z.array(WireMessageSchema),
  thinking: z
    .discriminatedUnion('type', [
      z.strictObject({ type: z.literal('disabled') }),
      z.strictObject({ type: z.literal('adaptive'), display: z.literal('summarized') }),
    ])
    .optional(),
  output_config: z
    .strictObject({
      format: z.strictObject({ type: z.literal('json_schema'), schema: JsonSchemaSchema }),
    })
    .optional(),
  tools: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        input_schema: JsonSchemaSchema,
        strict: z.literal(true),
      }),
    )
    .length(1)
    .optional(),
  tool_choice: z.strictObject({ type: z.literal('tool'), name: z.string().min(1) }).optional(),
});
export type MessagesRequest = z.infer<typeof MessagesRequestSchema>;

/** The request body for `req`. Throws if its messages break CTX-010's layout (CONV-041). */
export function buildMessagesRequest(req: TextRequest): MessagesRequest {
  const { system, messages } = buildPrompt(req.messages);
  const thinking = thinkingFor(req.profile.thinking);
  // req.sampling is never sent: version 2026-10-21 rejects every sampling setting (owner).
  return {
    model: req.profile.model,
    max_tokens: req.maxOutputTokens,
    // Always streamed, so one parser reads every response; onDelta is optional (PRV-045).
    stream: true,
    ...(system.length === 0 ? {} : { system }),
    messages,
    ...(thinking === undefined ? {} : { thinking }),
    ...formatFields(req),
  };
}

/**
 * The `system` blocks and the user and assistant messages for a prompt laid out as
 * CTX-010 lays it out:
 * - the leading system messages become `system` text blocks;
 * - consecutive same-role messages merge into one message with one block each;
 * - each `cacheBreakpoint` puts `cache_control` on its own block, and nowhere else;
 * - a message with no text is skipped, since the API refuses an empty block, and its
 *   breakpoint moves to the block before it.
 *
 * A system message after the conversation began, or more than MAX_CACHE_BREAKPOINTS
 * breakpoints, throws: the context module never builds either (CONV-041). Implements
 * PRV-041, PRV-043, and CTX-011.
 */
export function buildPrompt(messages: readonly ChatMessage[]): {
  system: TextBlock[];
  messages: WireMessage[];
} {
  const pieces = toPieces(messages);
  const breakpoints = pieces.filter((piece) => piece.breakpoint).length;
  if (breakpoints > MAX_CACHE_BREAKPOINTS) {
    throw new Error(
      `The prompt has ${String(breakpoints)} cache breakpoints; Anthropic accepts at most ` +
        `${String(MAX_CACHE_BREAKPOINTS)} (CTX-010 places three).`,
    );
  }
  const system: TextBlock[] = [];
  const turns: WireMessage[] = [];
  for (const piece of pieces) {
    if (piece.role === 'system') {
      system.push(toBlock(piece));
      continue;
    }
    const last = turns.at(-1);
    if (last?.role === piece.role) last.content.push(toBlock(piece));
    else turns.push({ role: piece.role, content: [toBlock(piece)] });
  }
  return { system, messages: turns };
}

/** One non-empty message, in prompt order, with its breakpoint after any move. */
type Piece = { role: ChatMessage['role']; text: string; breakpoint: boolean };

function toPieces(messages: readonly ChatMessage[]): Piece[] {
  const pieces: Piece[] = [];
  let conversationBegan = false;
  messages.forEach((message, index) => {
    if (message.role === 'system' && conversationBegan) {
      throw new Error(
        `Message ${String(index)} is a system message after a user or assistant message; ` +
          'CTX-010 puts every system message first.',
      );
    }
    if (message.role !== 'system') conversationBegan = true;
    const breakpoint = message.cacheBreakpoint === true;
    // The API refuses a text block with no visible text, so the message is left out.
    if (message.content.trim() === '') {
      const previous = pieces.at(-1);
      if (breakpoint && previous !== undefined) previous.breakpoint = true;
      return;
    }
    pieces.push({ role: message.role, text: message.content, breakpoint });
  });
  return pieces;
}

function toBlock(piece: Piece): TextBlock {
  return piece.breakpoint
    ? { type: 'text', text: piece.text, cache_control: { type: 'ephemeral' } }
    : { type: 'text', text: piece.text };
}

/**
 * What the profile's `thinking` asks for (owner): `off` disables it, which some models
 * refuse with a 400; `on` asks for adaptive thinking with its summary, since without
 * `display: 'summarized'` current models stream empty thinking text; `provider-default`
 * leaves the field out, so the model's own default applies.
 */
function thinkingFor(setting: ModelProfile['thinking']): MessagesRequest['thinking'] {
  switch (setting) {
    case 'off':
      return { type: 'disabled' };
    case 'on':
      return { type: 'adaptive', display: 'summarized' };
    case 'provider-default':
      return undefined;
  }
}

/**
 * The fields for a JSON response, by the profile's structured-output method. The schema
 * is sent as it arrives: the pipeline has already adapted it (PRV-050, PRV-052).
 * - `json-schema`: the native JSON output format, `output_config.format` (PRV-040);
 * - `tool-call`: one strict tool, forced with `tool_choice` (owner);
 * - `prompt-only`: nothing, since the prompt carries the format instruction.
 */
function formatFields(
  req: TextRequest,
): Pick<MessagesRequest, 'output_config' | 'tools' | 'tool_choice'> {
  if (req.format.type === 'text') return {};
  const { schemaName, jsonSchema } = req.format;
  switch (req.profile.structuredOutput) {
    case 'json-schema':
      return { output_config: { format: { type: 'json_schema', schema: jsonSchema } } };
    case 'tool-call':
      return {
        tools: [{ name: schemaName, input_schema: jsonSchema, strict: true }],
        tool_choice: { type: 'tool', name: schemaName },
      };
    case 'prompt-only':
      return {};
  }
}
