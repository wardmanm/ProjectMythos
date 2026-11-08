// The settings form's fields. Each has a label, then its notes (hint, default, restart), a
// warning, and the issues of the last save at its address, all tied to the control with
// aria-describedby, and aria-invalid while it has an issue (CON-091). Words carry every
// meaning; color only adds to them (UI-114).
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { FieldIssue } from './field-issues';

export type FieldNotes = {
  label: string;
  hint?: string | undefined;
  /** The schema's default, shown as "Default: …". */
  defaultText?: string | undefined;
  /** The field applies only after a restart (PRV-004). */
  needsRestart?: boolean | undefined;
  /** Something worth knowing that does not stop a save, such as CTX-032's warning. */
  warning?: string | null | undefined;
  /** The last save's issues at this field and below it. */
  issues?: readonly FieldIssue[] | undefined;
};

type ControlProps = { id: string; describedBy: string | undefined; invalid: true | undefined };

function Field({
  notes,
  inline = false,
  children,
}: {
  notes: FieldNotes;
  inline?: boolean;
  children: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const issues = notes.issues ?? [];
  const lines = [
    notes.hint,
    notes.defaultText === undefined ? undefined : `Default: ${notes.defaultText}`,
    notes.needsRestart === true ? 'Needs a restart.' : undefined,
  ].filter((line) => line !== undefined);
  const warning = notes.warning ?? null;
  const describedBy = [
    lines.length > 0 ? `${id}-notes` : null,
    warning === null ? null : `${id}-warning`,
    issues.length > 0 ? `${id}-issues` : null,
  ].filter((part) => part !== null);
  const control = children({
    id,
    describedBy: describedBy.length > 0 ? describedBy.join(' ') : undefined,
    invalid: issues.length > 0 ? true : undefined,
  });
  return (
    <div className="grid min-w-0 gap-1.5">
      {inline ? (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor={id}>{notes.label}</Label>
          {control}
        </div>
      ) : (
        <>
          <Label htmlFor={id}>{notes.label}</Label>
          {control}
        </>
      )}
      {lines.length > 0 && (
        <div id={`${id}-notes`} className="text-sm text-text-muted">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {warning !== null && (
        <p id={`${id}-warning`} className="flex items-start gap-2 text-sm">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
          {warning}
        </p>
      )}
      <IssueList id={`${id}-issues`} issues={issues} />
    </div>
  );
}

/** The last save's issues for a field or an item, each with an icon; nothing when none. */
export function IssueList({ id, issues }: { id?: string; issues: readonly FieldIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul id={id} className="grid gap-1 text-sm">
      {issues.map((issue, index) => (
        <li key={`${issue.address}-${String(index)}`} className="flex items-start gap-2">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-negative" />
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

type TextFieldProps = {
  notes: FieldNotes;
  value: string;
  onChange?: (value: string) => void;
  /** Shown but not editable, such as a saved item's id. */
  readOnly?: boolean;
  type?: 'text' | 'password';
  inputMode?: 'numeric';
  placeholder?: string;
  autoComplete?: string;
};

/** A one-line text field. */
export function TextField(props: TextFieldProps) {
  const { notes, value, onChange, readOnly = false } = props;
  return (
    <Field notes={notes}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type={props.type ?? 'text'}
          inputMode={props.inputMode}
          value={value}
          readOnly={readOnly}
          // A read-only field looks it: no box to type in, muted text.
          className={readOnly ? 'border-dashed text-text-muted' : undefined}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete ?? 'off'}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )}
    </Field>
  );
}

/** The number a field's text holds: null when blank, NaN when it is not a number. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  // Number('') is 0, so a blank field is caught before converting.
  return trimmed === '' ? null : Number(trimmed);
}

function textMatches(text: string, value: number | null | undefined): boolean {
  const parsed = parseNumber(text);
  if (parsed === null) return value === null || value === undefined || Number.isNaN(value);
  return Object.is(parsed, value);
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
}

/**
 * A number field. It keeps the text as typed and reports `parseNumber` of it: the caller
 * decides what a blank means. A value set from outside, as Discard does, replaces the text.
 * Text that is not a number becomes null in the JSON a save sends, and the server
 * reports it at this field.
 */
export function NumberField({
  notes,
  value,
  onChange,
}: {
  notes: FieldNotes;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(() => formatNumber(value));
  if (!textMatches(text, value)) setText(formatNumber(value));
  return (
    <Field notes={notes}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          inputMode="decimal"
          value={text}
          autoComplete="off"
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parseNumber(event.target.value));
          }}
        />
      )}
    </Field>
  );
}

/** An on-or-off setting. */
export function SwitchField({
  notes,
  checked,
  onChange,
}: {
  notes: FieldNotes;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Field notes={notes} inline>
      {({ id, describedBy, invalid }) => (
        <Switch
          id={id}
          checked={checked}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onCheckedChange={onChange}
        />
      )}
    </Field>
  );
}

export type Choice = { value: string; label: string };

/**
 * A choice from a list. The current value is always offered, even when the list leaves
 * it out, so a choice is never silently changed. An empty value shows `placeholder`.
 */
export function ChoiceField({
  notes,
  value,
  choices,
  onChange,
  placeholder = 'Choose one',
  disabled = false,
}: {
  notes: FieldNotes;
  value: string;
  choices: readonly Choice[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const listed = choices.some((choice) => choice.value === value);
  const all = listed || value === '' ? choices : [...choices, { value, label: value }];
  return (
    <Field notes={notes}>
      {({ id, describedBy, invalid }) => (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            id={id}
            className="w-full"
            aria-describedby={describedBy}
            aria-invalid={invalid}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {all.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}
