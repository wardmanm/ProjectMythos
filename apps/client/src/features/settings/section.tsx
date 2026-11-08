import { Trash2Icon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { FieldIssue } from './field-issues';
import { IssueList } from './form-fields';
import type { ItemState, SettingsDraft } from './settings-draft';

/** Applies a change to the draft; changes are functions, so none is lost to a stale copy. */
export type DraftChange = (change: (draft: SettingsDraft) => SettingsDraft) => void;

/** What every section of the form gets. */
export type SectionProps = {
  draft: SettingsDraft;
  /** The config as last saved, to tell new and changed items from saved ones. */
  base: SettingsDraft;
  issues: readonly FieldIssue[];
  change: DraftChange;
};

/** One section of the settings screen: a region named by its heading. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="font-display text-xl">
          {title}
        </h2>
        {actions}
      </div>
      {description !== undefined && <p className="text-text-muted">{description}</p>}
      {children}
    </section>
  );
}

/** The hint a list item's id field shows: ids are fixed once saved (14-ui Decisions). */
export function idHint(saved: boolean): string {
  return saved
    ? 'Fixed once saved, since other settings refer to it. To change it, add a new one and remove this one.'
    : 'Lowercase letters, digits, and dashes, such as macbook-gpu. Fixed once saved.';
}

const stateWords = { new: 'New', changed: 'Unsaved changes', saved: null } as const;

/**
 * One device, provider, or profile: a group named by its heading, with whether it is new
 * or changed since the last save, its own issues, and Remove.
 */
export function ItemCard({
  title,
  state,
  issues,
  removeLabel,
  onRemove,
  status,
  children,
}: {
  title: string;
  state: ItemState;
  /** Issues about the item as a whole. */
  issues: readonly FieldIssue[];
  removeLabel: string;
  onRemove: () => void;
  status?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const words = stateWords[state];
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="grid gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="min-w-0 font-medium break-words">
          {title}
        </h3>
        {words !== null && <Badge variant="outline">{words}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {status}
          <Button variant="ghost" size="icon" aria-label={removeLabel} onClick={onRemove}>
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      </div>
      <IssueList issues={issues} />
      {children}
    </div>
  );
}
