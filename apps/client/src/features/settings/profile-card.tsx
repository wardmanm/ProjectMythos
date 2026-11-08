import type { ModelProfile, ProviderConfig } from '@mythos/contracts';
import { addressOf, issuesAt, issuesExactlyAt, type FieldIssue } from './field-issues';
import { ChoiceField, NumberField, TextField, type Choice } from './form-fields';
import { ModelPicker } from './model-picker';
import { ProbePanel } from './probe-panel';
import { MoreProfileFields } from './sampling-fields';
import { schemaDefaults } from './schema-defaults';
import { idHint, ItemCard } from './section';
import { withOptional, type ItemState, type Keyed } from './settings-draft';

/**
 * CTX-032: below this context window, the fixed prompt tiers may not fit. The server's
 * copy is `MIN_CONTEXT_WINDOW` in providers' `probe-report.ts`; the client cannot import
 * it (ARCH-010), so the value is repeated here.
 */
export const MIN_CONTEXT_WINDOW = 8_192;

const kindChoices: Choice[] = [
  { value: 'text', label: 'Text: narration and rulings' },
  { value: 'embedding', label: 'Embedding: finding memories' },
];
const methodChoices: Choice[] = [
  { value: 'json-schema', label: 'JSON schema' },
  { value: 'tool-call', label: 'Tool call' },
  { value: 'prompt-only', label: 'Prompt only' },
];
const thinkingChoices: Choice[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
  { value: 'provider-default', label: "The provider's default" },
];

/** CTX-032's warning, for a text profile whose context window is too small. */
// Implements CTX-032: the settings screen warns, and the save still goes ahead.
export function contextWindowWarning(profile: ModelProfile): string | null {
  if (profile.kind !== 'text' || !(profile.contextWindow < MIN_CONTEXT_WINDOW)) return null;
  return `Below ${MIN_CONTEXT_WINDOW.toLocaleString('en-US')} tokens, prompts may not fit and turns can fail.`;
}

/**
 * The hint for an Anthropic profile set to turn thinking off: some models refuse it
 * (05-providers Decisions, PRV-046).
 */
function thinkingWarning(
  profile: ModelProfile,
  provider: ProviderConfig | undefined,
): string | null {
  if (provider?.type !== 'anthropic' || profile.thinking !== 'off') return null;
  return "Claude Opus 5.5, Sonnet 5.5, and Fable 5.1 can't turn thinking off: choose the provider's default.";
}

type CardProps = {
  item: Keyed<ModelProfile>;
  state: ItemState;
  /** The draft's provider with the profile's `providerId`, and whether it is as saved. */
  provider: ProviderConfig | undefined;
  providerSaved: boolean;
  providerChoices: readonly Choice[];
  issues: readonly FieldIssue[];
  onChange: (value: ModelProfile) => void;
  onRemove: () => void;
};

/**
 * One model profile: its model, chosen from the provider's list (PRV-091), its limits
 * and methods, the rarer fields under "More", and Probe (PRV-090), which needs the
 * profile and its provider saved.
 */
export function ProfileCard(props: CardProps) {
  const { item, state, provider, providerSaved, issues, onChange } = props;
  const profile = item.value;
  const address = addressOf('modelProfiles', item.key);
  const at = (field: string) => issuesAt(issues, addressOf(address, field));
  return (
    <ItemCard
      title={`Model profile ${profile.id}`}
      state={state}
      issues={issuesExactlyAt(issues, address)}
      removeLabel={`Remove model profile ${profile.id}`}
      onRemove={props.onRemove}
    >
      <TextField
        notes={{ label: 'Identifier', hint: idHint(state !== 'new'), issues: at('id') }}
        value={profile.id}
        readOnly={state !== 'new'}
        onChange={(id) => {
          onChange({ ...profile, id });
        }}
      />
      <ChoiceField
        notes={{ label: 'Provider', issues: at('providerId') }}
        value={profile.providerId}
        choices={props.providerChoices}
        onChange={(providerId) => {
          onChange({ ...profile, providerId });
        }}
      />
      <ModelPicker
        model={profile.model}
        providerId={profile.providerId}
        providerSaved={providerSaved}
        issues={at('model')}
        onChange={(model) => {
          onChange({ ...profile, model });
        }}
      />
      <ChoiceField
        notes={{ label: 'Kind', issues: at('kind') }}
        value={profile.kind}
        choices={kindChoices}
        onChange={(kind) => {
          if (kind === 'text' || kind === 'embedding') onChange({ ...profile, kind });
        }}
      />
      <LimitFields profile={profile} at={at} onChange={onChange} />
      <MethodFields profile={profile} provider={provider} at={at} onChange={onChange} />
      <MoreProfileFields
        profile={profile}
        address={address}
        issues={issues}
        samplingIgnored={provider?.type === 'anthropic'}
        onChange={onChange}
      />
      <ProbePanel profileId={profile.id} ready={state === 'saved' && providerSaved} />
    </ItemCard>
  );
}

function isMethod(value: string): value is ModelProfile['structuredOutput'] {
  return methodChoices.some((choice) => choice.value === value);
}

function isThinking(value: string): value is ModelProfile['thinking'] {
  return thinkingChoices.some((choice) => choice.value === value);
}

/** How a profile is held to a schema, and whether it thinks. */
function MethodFields({
  profile,
  provider,
  at,
  onChange,
}: {
  profile: ModelProfile;
  provider: ProviderConfig | undefined;
  at: (field: string) => FieldIssue[];
  onChange: (value: ModelProfile) => void;
}) {
  return (
    <>
      <ChoiceField
        notes={{
          label: 'Structured output',
          hint: 'How the model is held to a schema. Probe shows which methods work.',
          issues: at('structuredOutput'),
        }}
        value={profile.structuredOutput}
        choices={methodChoices}
        onChange={(method) => {
          if (isMethod(method)) onChange({ ...profile, structuredOutput: method });
        }}
      />
      <ChoiceField
        notes={{
          label: 'Thinking',
          defaultText: schemaDefaults.profile.thinking,
          warning: thinkingWarning(profile, provider),
          issues: at('thinking'),
        }}
        value={profile.thinking}
        choices={thinkingChoices}
        onChange={(thinking) => {
          if (isThinking(thinking)) onChange({ ...profile, thinking });
        }}
      />
    </>
  );
}

/** The context window, the output limit, and an embedding profile's dimensions. */
function LimitFields({
  profile,
  at,
  onChange,
}: {
  profile: ModelProfile;
  at: (field: string) => FieldIssue[];
  onChange: (value: ModelProfile) => void;
}) {
  return (
    <>
      <NumberField
        notes={{
          label: 'Context window, in tokens',
          hint: "What the runtime is set up for, such as Ollama's num_ctx.",
          warning: contextWindowWarning(profile),
          issues: at('contextWindow'),
        }}
        value={profile.contextWindow}
        onChange={(contextWindow) => {
          onChange({ ...profile, contextWindow: contextWindow ?? Number.NaN });
        }}
      />
      <NumberField
        notes={{ label: 'Most output tokens', issues: at('maxOutputTokens') }}
        value={profile.maxOutputTokens}
        onChange={(maxOutputTokens) => {
          onChange({ ...profile, maxOutputTokens: maxOutputTokens ?? Number.NaN });
        }}
      />
      {profile.kind === 'embedding' && (
        <NumberField
          notes={{
            label: 'Embedding dimensions',
            hint: 'Required for an embedding profile.',
            issues: at('embeddingDimensions'),
          }}
          value={profile.embeddingDimensions}
          onChange={(dimensions) => {
            onChange(withOptional(profile, 'embeddingDimensions', dimensions ?? undefined));
          }}
        />
      )}
    </>
  );
}
