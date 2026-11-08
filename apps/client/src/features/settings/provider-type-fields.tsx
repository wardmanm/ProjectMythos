import type { ProviderConfig } from '@mythos/contracts';
import { addressOf, issuesAt, type FieldIssue } from './field-issues';
import { NumberField, TextField } from './form-fields';
import { HeadersField } from './headers-field';
import { schemaDefaults } from './schema-defaults';
import { SecretField, type Secret } from './secret-field';
import { withOptional } from './settings-draft';

type Of<T extends ProviderConfig['type']> = Extract<ProviderConfig, { type: T }>;

type FieldsProps<T extends ProviderConfig['type']> = {
  provider: Of<T>;
  /** `providers.<key>`. */
  address: string;
  issues: readonly FieldIssue[];
  /** The key as last saved, for a saved provider of the same type. */
  savedKey: Secret | undefined;
  onChange: (value: ProviderConfig) => void;
};

/** A blank optional text field is left out of the config. */
function blankToUndefined(text: string): string | undefined {
  return text.trim() === '' ? undefined : text;
}

function OllamaFields({ provider, address, issues, onChange }: FieldsProps<'ollama'>) {
  return (
    <>
      <TextField
        notes={{
          label: 'Server address',
          hint: 'Such as http://localhost:11434.',
          issues: issuesAt(issues, addressOf(address, 'baseUrl')),
        }}
        value={provider.baseUrl}
        onChange={(baseUrl) => {
          onChange({ ...provider, baseUrl });
        }}
      />
      <TextField
        notes={{
          label: 'Keep the model loaded for',
          hint: "Ollama's keep_alive, such as 30m or 2h.",
          defaultText: schemaDefaults.ollamaKeepAlive,
          issues: issuesAt(issues, addressOf(address, 'keepAlive')),
        }}
        value={provider.keepAlive}
        onChange={(keepAlive) => {
          onChange({ ...provider, keepAlive });
        }}
      />
    </>
  );
}

function OpenAiCompatibleFields(props: FieldsProps<'openai-compatible'>) {
  const { provider, address, issues, onChange } = props;
  return (
    <>
      <TextField
        notes={{
          label: 'Server address',
          hint: 'Including /v1, such as http://localhost:1234/v1.',
          issues: issuesAt(issues, addressOf(address, 'baseUrl')),
        }}
        value={provider.baseUrl}
        onChange={(baseUrl) => {
          onChange({ ...provider, baseUrl });
        }}
      />
      <SecretField
        value={provider.apiKey}
        saved={props.savedKey}
        allowNone
        address={addressOf(address, 'apiKey')}
        issues={issues}
        onChange={(apiKey) => {
          onChange(withOptional(provider, 'apiKey', apiKey));
        }}
      />
      <HeadersField
        headers={provider.headers}
        address={addressOf(address, 'headers')}
        issues={issues}
        onChange={(headers) => {
          onChange({ ...provider, headers });
        }}
      />
    </>
  );
}

function AnthropicFields(props: FieldsProps<'anthropic'>) {
  const { provider, address, issues, onChange } = props;
  return (
    <>
      <SecretField
        value={provider.apiKey}
        saved={props.savedKey}
        allowNone={false}
        address={addressOf(address, 'apiKey')}
        issues={issues}
        onChange={(apiKey) => {
          if (apiKey !== undefined) onChange({ ...provider, apiKey });
        }}
      />
      <TextField
        notes={{
          label: 'Server address',
          hint: 'Leave it blank for https://api.anthropic.com.',
          issues: issuesAt(issues, addressOf(address, 'baseUrl')),
        }}
        value={provider.baseUrl ?? ''}
        onChange={(text) => {
          onChange(withOptional(provider, 'baseUrl', blankToUndefined(text)));
        }}
      />
    </>
  );
}

function MockFields({ provider, address, issues, onChange }: FieldsProps<'mock'>) {
  return (
    <>
      <TextField
        notes={{
          label: 'Fixtures folder',
          hint: 'Recorded answers to replay. Leave it blank for placeholder answers.',
          issues: issuesAt(issues, addressOf(address, 'fixturesDir')),
        }}
        value={provider.fixturesDir ?? ''}
        onChange={(text) => {
          onChange(withOptional(provider, 'fixturesDir', blankToUndefined(text)));
        }}
      />
      <NumberField
        notes={{
          label: 'Pause per streamed word, in milliseconds',
          defaultText: String(schemaDefaults.mockDelayMs),
          issues: issuesAt(issues, addressOf(address, 'delayMs')),
        }}
        value={provider.delayMs}
        onChange={(delayMs) => {
          onChange({ ...provider, delayMs: delayMs ?? Number.NaN });
        }}
      />
    </>
  );
}

/** A ComfyUI provider is shown but not edited: image generation arrives in phase 9. */
function ComfyUiFields({ provider }: FieldsProps<'comfyui'>) {
  return (
    <>
      <TextField notes={{ label: 'Server address' }} value={provider.baseUrl} readOnly />
      <p className="text-sm text-text-muted">
        Image generation arrives in a later version, so this provider can&apos;t be changed here
        yet.
      </p>
    </>
  );
}

/** The fields one provider type has beyond its id, type, and device. */
export function ProviderTypeFields(props: FieldsProps<ProviderConfig['type']>) {
  const { provider } = props;
  switch (provider.type) {
    case 'ollama':
      return <OllamaFields {...props} provider={provider} />;
    case 'openai-compatible':
      return <OpenAiCompatibleFields {...props} provider={provider} />;
    case 'anthropic':
      return <AnthropicFields {...props} provider={provider} />;
    case 'mock':
      return <MockFields {...props} provider={provider} />;
    case 'comfyui':
      return <ComfyUiFields {...props} provider={provider} />;
  }
}
