import type { MachineConfig } from '@mythos/contracts';
import { useCallback, useState } from 'react';
import { useSaveSettings } from '@/api/settings';
import { validationIssuesOf } from '@/api/validation-issues';
import { FailureMessage } from '@/components/failure-message';
import { Button } from '@/components/ui/button';
import { AdvancedSection } from './advanced-section';
import { DevicesSection } from './devices-section';
import { fieldIssuesOf, type FieldIssue } from './field-issues';
import { IssueSummary } from './issue-summary';
import { PinSection } from './pin-section';
import { ProfilesSection } from './profiles-section';
import { ProvidersSection } from './providers-section';
import { RolesSection } from './roles-section';
import type { DraftChange, SectionProps } from './section';
import { ServerSection } from './server-section';
import { configFrom, draftFrom, isDirty, type SettingsDraft } from './settings-draft';

type Drafts = { base: SettingsDraft; draft: SettingsDraft };

/**
 * The machine config as one draft with one Save, which sends it whole with
 * `PUT /settings` (PRV-003). A save that fails lists every issue, each at its field
 * (CON-091); one that succeeds starts again from the config as saved. The PIN section
 * sits outside the draft: it saves on its own and applies at once (PRV-004).
 */
export function SettingsForm({
  latest,
  onSaved,
}: {
  /** The config as the server last answered it; the PIN is always taken from here. */
  latest: MachineConfig;
  onSaved: (restartRequired: boolean) => void;
}) {
  const save = useSaveSettings();
  const [drafts, setDrafts] = useState<Drafts>(() => {
    const base = draftFrom(latest);
    return { base, draft: base };
  });
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const { base, draft } = drafts;
  const dirty = isDirty(draft, base);

  const change: DraftChange = useCallback((update) => {
    setDrafts((current) => ({ ...current, draft: update(current.draft) }));
    setSaved(false);
  }, []);

  const submit = () => {
    const sent = draft;
    save.mutate(configFrom(sent, latest.server.pin), {
      onSuccess: (result) => {
        const next = draftFrom(result.config);
        setDrafts({ base: next, draft: next });
        setIssues([]);
        setSaved(true);
        onSaved(result.restartRequired);
      },
      onError: (error) => {
        setIssues(fieldIssuesOf(validationIssuesOf(error), sent));
      },
    });
  };
  const discard = () => {
    setDrafts({ base, draft: base });
    setIssues([]);
    save.reset();
  };

  const props: SectionProps = { draft, base, issues, change };
  return (
    <div className="grid gap-8">
      <IssueSummary issues={issues} />
      <fieldset disabled={save.isPending} className="grid min-w-0 gap-8">
        <ProvidersSection {...props} />
        <ProfilesSection {...props} />
        <RolesSection {...props} />
        <DevicesSection {...props} />
        <ServerSection {...props} />
        <AdvancedSection {...props} />
      </fieldset>
      <SaveBar
        canSave={dirty && !save.isPending}
        status={statusWords({ saving: save.isPending, dirty, saved, failed: issues.length > 0 })}
        failure={save.isError && validationIssuesOf(save.error).length === 0 ? save.error : null}
        onSave={submit}
        onDiscard={discard}
      />
      <PinSection pin={latest.server.pin} editsPending={dirty} />
    </div>
  );
}

function statusWords(state: { saving: boolean; dirty: boolean; saved: boolean; failed: boolean }) {
  if (state.saving) return 'Saving…';
  if (state.failed) return 'Not saved. Each problem is listed at the top and at its field.';
  if (state.dirty) return 'Unsaved changes';
  return state.saved ? 'Saved.' : '';
}

/** Save and Discard, kept in view at the bottom of the screen, with what has happened. */
function SaveBar({
  canSave,
  status,
  failure,
  onSave,
  onDiscard,
}: {
  canSave: boolean;
  status: string;
  /** A failed save with no issues to show at fields, such as an unreachable server. */
  failure: Error | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 grid gap-2 border-t border-border bg-background py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!canSave} onClick={onSave}>
          Save
        </Button>
        <Button variant="ghost" disabled={!canSave} onClick={onDiscard}>
          Discard
        </Button>
        <p role="status" className="text-sm text-text-muted">
          {status}
        </p>
      </div>
      {failure !== null && <FailureMessage error={failure} />}
    </div>
  );
}
