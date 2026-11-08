import { SECRET_PLACEHOLDER, type SecretSchema } from '@mythos/contracts';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { addressOf, issuesAt, issuesExactlyAt, type FieldIssue } from './field-issues';
import { ChoiceField, IssueList, TextField } from './form-fields';

export type Secret = z.infer<typeof SecretSchema>;
type SecretSource = 'env' | 'stored' | 'none';

function sourceOf(secret: Secret | undefined): SecretSource {
  if (secret === undefined) return 'none';
  return 'env' in secret ? 'env' : 'stored';
}

function isPlaceholder(secret: Secret | undefined): boolean {
  return secret !== undefined && 'value' in secret && secret.value === SECRET_PLACEHOLDER;
}

/**
 * A provider's API key. A stored key arrives as the placeholder and shows only as set,
 * with Replace; the placeholder goes back unchanged, so the saved key is kept (CON-111).
 * A key typed here is sent once, then shows as set like any other. An environment
 * variable shows its name, the safer choice. Implements PRV-005.
 */
export function SecretField({
  value,
  saved,
  allowNone,
  address,
  issues,
  onChange,
}: {
  value: Secret | undefined;
  /** The key as last saved, for a saved provider of the same type. */
  saved: Secret | undefined;
  /** Whether the provider may have no key (`openai-compatible`). */
  allowNone: boolean;
  /** The field's address, `providers.<key>.apiKey`. */
  address: string;
  issues: readonly FieldIssue[];
  onChange: (value: Secret | undefined) => void;
}) {
  const source = sourceOf(value);
  const choices = [
    { value: 'env', label: 'An environment variable' },
    { value: 'stored', label: 'Stored in settings' },
    ...(allowNone ? [{ value: 'none', label: 'No key' }] : []),
  ];
  const choose = (next: string) => {
    if (next === 'none') onChange(undefined);
    if (next === 'env') onChange(saved !== undefined && 'env' in saved ? saved : { env: '' });
    if (next === 'stored') onChange(isPlaceholder(saved) ? saved : { value: '' });
  };
  return (
    <div className="grid gap-4">
      <ChoiceField
        notes={{ label: 'API key from', issues: issuesExactlyAt(issues, address) }}
        value={source}
        choices={choices}
        onChange={choose}
      />
      {value !== undefined && 'env' in value && (
        <TextField
          notes={{
            label: 'Environment variable',
            hint: 'Safer than storing the key: it never sits in the settings file.',
            issues: issuesAt(issues, addressOf(address, 'env')),
          }}
          value={value.env}
          placeholder="ANTHROPIC_API_KEY"
          onChange={(env) => {
            onChange({ env });
          }}
        />
      )}
      {value !== undefined && 'value' in value && (
        <StoredKey
          value={value.value}
          canKeepSaved={isPlaceholder(saved)}
          issues={issuesAt(issues, addressOf(address, 'value'))}
          onChange={(key) => {
            onChange({ value: key });
          }}
        />
      )}
    </div>
  );
}

function StoredKey({
  value,
  canKeepSaved,
  issues,
  onChange,
}: {
  value: string;
  canKeepSaved: boolean;
  issues: readonly FieldIssue[];
  onChange: (value: string) => void;
}) {
  if (value === SECRET_PLACEHOLDER) {
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p>A key is set.</p>
          <Button
            variant="outline"
            onClick={() => {
              onChange('');
            }}
          >
            Replace the key
          </Button>
        </div>
        <IssueList issues={issues} />
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <TextField
        notes={{
          label: 'API key',
          hint: 'Kept on this computer only, and never shown again once saved.',
          issues,
        }}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={onChange}
      />
      {canKeepSaved && (
        <Button
          variant="ghost"
          className="justify-self-start"
          onClick={() => {
            onChange(SECRET_PLACEHOLDER);
          }}
        >
          Keep the saved key
        </Button>
      )}
    </div>
  );
}
