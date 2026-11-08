import { useProviderModels } from '@/api/settings';
import { FailureMessage } from '@/components/failure-message';
import type { FieldIssue } from './field-issues';
import { ChoiceField, TextField } from './form-fields';

/**
 * A profile's model: typed, or chosen from the models its provider lists (PRV-091). The
 * list comes from the saved config on the server, so it waits until the provider is
 * saved; a model the provider does not list can still be typed.
 */
export function ModelPicker({
  model,
  providerId,
  providerSaved,
  issues,
  onChange,
}: {
  model: string;
  providerId: string;
  providerSaved: boolean;
  issues: readonly FieldIssue[];
  onChange: (model: string) => void;
}) {
  const canList = providerSaved && providerId !== '';
  const models = useProviderModels(providerId, canList);
  return (
    <div className="grid gap-3">
      <TextField
        notes={{
          label: 'Model',
          hint: "The provider's name for it, such as qwen3.6:35b-a3b.",
          issues,
        }}
        value={model}
        onChange={onChange}
      />
      {!canList && <p className="text-sm text-text-muted">Save the provider to list its models.</p>}
      {canList && models.isPending && (
        <p className="text-sm text-text-muted">Listing the provider&apos;s models…</p>
      )}
      {canList && models.isError && (
        <div className="grid gap-2">
          <p className="text-sm">Couldn&apos;t list the provider&apos;s models.</p>
          <FailureMessage error={models.error} />
        </div>
      )}
      {canList && models.isSuccess && models.data.length === 0 && (
        <p className="text-sm text-text-muted">The provider lists no models.</p>
      )}
      {canList && models.isSuccess && models.data.length > 0 && (
        <ChoiceField
          notes={{ label: "Choose from the provider's models" }}
          value={models.data.includes(model) ? model : ''}
          choices={models.data.map((name) => ({ value: name, label: name }))}
          placeholder="Choose a model"
          onChange={onChange}
        />
      )}
    </div>
  );
}
