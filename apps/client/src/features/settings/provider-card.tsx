import type { ProviderConfig } from '@mythos/contracts';
import { addressOf, issuesAt, issuesExactlyAt, type FieldIssue } from './field-issues';
import { ChoiceField, TextField, type Choice } from './form-fields';
import { HealthDot, type HealthView } from './health-dot';
import { ProviderTypeFields } from './provider-type-fields';
import type { Secret } from './secret-field';
import { idHint, ItemCard } from './section';
import {
  providerOfType,
  type EditableProviderType,
  type ItemState,
  type Keyed,
} from './settings-draft';

const typeChoices: Choice[] = [
  { value: 'ollama', label: 'Ollama' },
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible: LM Studio, llama.cpp, vLLM, OpenRouter',
  },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'mock', label: 'Mock, for trying Mythos without a model' },
];

function isEditableType(type: string): type is EditableProviderType {
  return typeChoices.some((choice) => choice.value === type);
}

/** The saved key a provider's key field can go back to: only one saved with the same type. */
function savedKeyOf(saved: ProviderConfig | undefined, type: string): Secret | undefined {
  if (saved === undefined || saved.type !== type || !('apiKey' in saved)) return undefined;
  return saved.apiKey;
}

/**
 * One provider: its id, type, and device, the fields of its type, and its health
 * (PRV-091). The id and type are fixed once saved, since profiles and stored keys refer
 * to the id (CON-111). A ComfyUI provider is shown but not edited until phase 9.
 */
export function ProviderCard({
  item,
  state,
  saved,
  deviceChoices,
  health,
  issues,
  onChange,
  onRemove,
}: {
  item: Keyed<ProviderConfig>;
  state: ItemState;
  /** The provider as last saved, if it is saved. */
  saved: ProviderConfig | undefined;
  deviceChoices: readonly Choice[];
  health: HealthView;
  issues: readonly FieldIssue[];
  onChange: (value: ProviderConfig) => void;
  onRemove: () => void;
}) {
  const provider = item.value;
  const isSaved = state !== 'new';
  const address = addressOf('providers', item.key);
  const at = (field: string) => issuesAt(issues, addressOf(address, field));
  const detail = health.kind === 'checked' ? health.health.detail : '';
  return (
    <ItemCard
      title={`Provider ${provider.id}`}
      state={state}
      issues={issuesExactlyAt(issues, address)}
      removeLabel={`Remove provider ${provider.id}`}
      onRemove={onRemove}
      status={<HealthDot view={health} />}
    >
      {detail !== '' && <p className="text-sm text-text-muted">{detail}</p>}
      <TextField
        notes={{ label: 'Identifier', hint: idHint(isSaved), issues: at('id') }}
        value={provider.id}
        readOnly={isSaved}
        onChange={(id) => {
          onChange({ ...provider, id });
        }}
      />
      <ChoiceField
        notes={{
          label: 'Type',
          hint: isSaved ? 'Fixed once saved.' : undefined,
          issues: at('type'),
        }}
        value={provider.type}
        choices={
          provider.type === 'comfyui' ? [{ value: 'comfyui', label: 'ComfyUI' }] : typeChoices
        }
        disabled={isSaved || provider.type === 'comfyui'}
        onChange={(type) => {
          if (isEditableType(type)) onChange(providerOfType(type, provider.id, provider.deviceId));
        }}
      />
      <ChoiceField
        notes={{ label: 'Device', issues: at('deviceId') }}
        value={provider.deviceId}
        choices={deviceChoices}
        onChange={(deviceId) => {
          onChange({ ...provider, deviceId });
        }}
      />
      <ProviderTypeFields
        provider={provider}
        address={address}
        issues={issues}
        savedKey={savedKeyOf(saved, provider.type)}
        onChange={onChange}
      />
    </ItemCard>
  );
}
