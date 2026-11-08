import {
  advancedGroups,
  defaultWords,
  valueAt,
  withValueAt,
  type AdvancedField,
} from './advanced-fields';
import { issuesAt } from './field-issues';
import { ChoiceField, NumberField, SwitchField } from './form-fields';
import { schemaDefaults } from './schema-defaults';
import { Section, type SectionProps } from './section';

/** One Advanced field, with its default from the schema and its issues. */
function AdvancedInput({
  field,
  draft,
  issues,
  change,
}: { field: AdvancedField } & Omit<SectionProps, 'base'>) {
  const value = valueAt(draft, field.path);
  const notes = {
    label: field.label,
    hint: field.kind === 'number-or-null' ? field.blankMeans : field.hint,
    defaultText: defaultWords(field, valueAt(schemaDefaults.config, field.path)),
    issues: issuesAt(issues, field.path.join('.')),
  };
  const set = (next: unknown) => {
    change((d) => withValueAt(d, field.path, next));
  };
  switch (field.kind) {
    case 'number':
      return (
        <NumberField
          notes={notes}
          value={typeof value === 'number' ? value : undefined}
          onChange={(number) => {
            set(number ?? Number.NaN);
          }}
        />
      );
    case 'number-or-null':
      return (
        <NumberField
          notes={notes}
          value={typeof value === 'number' ? value : null}
          onChange={set}
        />
      );
    case 'switch':
      return <SwitchField notes={notes} checked={value === true} onChange={set} />;
    case 'choice':
      return (
        <ChoiceField
          notes={notes}
          value={typeof value === 'string' ? value : ''}
          choices={field.choices}
          onChange={set}
        />
      );
  }
}

/**
 * The `context`, `world`, `memory`, `queue`, and `retention` settings, each field with its
 * default (UI-088, PRV-008, PRV-009). Folded away by default: most players never need them.
 */
export function AdvancedSection({ draft, issues, change }: SectionProps) {
  return (
    <Section
      title="Advanced"
      description="Tuning for prompts, the off-screen world, memory, the job queue, and records. Every value has a default."
    >
      <details className="grid gap-6">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Show the advanced settings
        </summary>
        {advancedGroups.map((group) => (
          <div key={group.title} className="grid gap-4 pt-4">
            <h3 className="font-medium">{group.title}</h3>
            <p className="text-sm text-text-muted">{group.description}</p>
            {group.fields.map((field) => (
              <AdvancedInput
                key={field.path.join('.')}
                field={field}
                draft={draft}
                issues={issues}
                change={change}
              />
            ))}
          </div>
        ))}
      </details>
    </Section>
  );
}
