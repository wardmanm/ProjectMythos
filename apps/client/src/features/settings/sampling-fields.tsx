import type { ModelProfile } from '@mythos/contracts';
import { issuesAt, type FieldIssue } from './field-issues';
import { NumberField, SwitchField } from './form-fields';
import { schemaDefaults } from './schema-defaults';
import { withOptional } from './settings-draft';

type Sampling = ModelProfile['sampling'];

const samplingFields = [
  ['temperature', 'Temperature', 'From 0 to 2. Lower is steadier, higher more varied.'],
  ['topP', 'Top p', 'From 0 to 1.'],
  ['topK', 'Top k', 'A whole number above 0.'],
  ['repeatPenalty', 'Repeat penalty', 'Above 0.'],
  ['presencePenalty', 'Presence penalty', undefined],
] as const satisfies readonly (readonly [keyof Sampling, string, string | undefined])[];

/**
 * A profile's rarer fields, behind "More": streaming, the five sampling values, the
 * starting characters per token, and the timeout. A blank sampling value is left out,
 * so the model's own applies.
 */
export function MoreProfileFields({
  profile,
  address,
  issues,
  samplingIgnored,
  onChange,
}: {
  profile: ModelProfile;
  /** `modelProfiles.<key>`. */
  address: string;
  issues: readonly FieldIssue[];
  /** Anthropic's adapter sends no sampling values (05-providers Decisions). */
  samplingIgnored: boolean;
  onChange: (profile: ModelProfile) => void;
}) {
  const defaults = schemaDefaults.profile;
  const at = (field: string) => issuesAt(issues, `${address}.${field}`);
  return (
    <details className="grid gap-4">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">More</summary>
      <div className="grid gap-4 pt-2">
        <SwitchField
          notes={{
            label: 'Stream the answer',
            defaultText: defaults.streaming ? 'on' : 'off',
            issues: at('streaming'),
          }}
          checked={profile.streaming}
          onChange={(streaming) => {
            onChange({ ...profile, streaming });
          }}
        />
        <p className="text-sm text-text-muted">
          {samplingIgnored
            ? 'Anthropic models ignore these sampling values.'
            : "Sampling values. Leave one blank for the model's own."}
        </p>
        {samplingFields.map(([field, label, hint]) => (
          <NumberField
            key={field}
            notes={{ label, hint, issues: at(`sampling.${field}`) }}
            value={profile.sampling[field]}
            onChange={(value) => {
              const sampling = withOptional(profile.sampling, field, value ?? undefined);
              onChange({ ...profile, sampling });
            }}
          />
        ))}
        <NumberField
          notes={{
            label: 'Characters per token, to start with',
            hint: 'Mythos refines it from what the provider reports.',
            defaultText: String(defaults.charsPerToken),
            issues: at('charsPerToken'),
          }}
          value={profile.charsPerToken}
          onChange={(charsPerToken) => {
            onChange({ ...profile, charsPerToken: charsPerToken ?? Number.NaN });
          }}
        />
        <NumberField
          notes={{
            label: 'Timeout, in milliseconds',
            hint: 'How long to wait for the model to start answering, or to send more.',
            defaultText: String(defaults.timeoutMs),
            issues: at('timeoutMs'),
          }}
          value={profile.timeoutMs}
          onChange={(timeoutMs) => {
            onChange({ ...profile, timeoutMs: timeoutMs ?? Number.NaN });
          }}
        />
      </div>
    </details>
  );
}
