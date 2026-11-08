import type { SemanticIssue } from '@mythos/contracts';
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The issues at one field, each in the server's own words (CON-091): they are written for the
 * player. Color only adds to the words (UI-114).
 */
export function FieldIssues({ id, issues }: { id: string; issues: readonly SemanticIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul id={id} className="flex flex-col gap-1 text-sm text-negative">
      {issues.map((issue, index) => (
        <li key={`${String(index)} ${issue.message}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

/** The attributes that tie a field to its issues, so screen readers read them with it. */
function invalidProps(issuesId: string, issues: readonly SemanticIssue[]) {
  return issues.length === 0 ? {} : { 'aria-invalid': true as const, 'aria-describedby': issuesId };
}

export function NameField({
  value,
  maxLength,
  issues,
  onChange,
}: {
  value: string;
  maxLength: number;
  issues: readonly SemanticIssue[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="campaign-name">Campaign name</Label>
      <Input
        id="campaign-name"
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        {...invalidProps('campaign-name-issues', issues)}
      />
      <FieldIssues id="campaign-name-issues" issues={issues} />
    </div>
  );
}

export type SelectOption = { value: string; label: string };

/** A labelled select with its issues, and anything that explains the choice below it. */
export function SelectField({
  id,
  label,
  value,
  options,
  issues,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: readonly SelectOption[];
  issues: readonly SemanticIssue[];
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  const issuesId = `${id}-issues`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ''} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger id={id} className="w-full" {...invalidProps(issuesId, issues)}>
          <SelectValue placeholder="None to choose from" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
      <FieldIssues id={issuesId} issues={issues} />
    </div>
  );
}
