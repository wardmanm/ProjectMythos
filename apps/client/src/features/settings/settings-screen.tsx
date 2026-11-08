import { InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { useSettings } from '@/api/settings';
import { validationIssuesOf } from '@/api/validation-issues';
import { FailureMessage } from '@/components/failure-message';
import { BrokenConfig } from './broken-config';
import { SettingsForm } from './settings-form';

/**
 * PRV-004: after a save the server says needs a restart. The server reports it only in
 * the save's answer, so a reload forgets it (05-providers Open); the fields that need a
 * restart say so too.
 */
function RestartNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-l-4 border-l-accent bg-surface p-3"
    >
      <InfoIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
      <p className="min-w-0">
        Saved. Restart Mythos to use the new network address, port, or data folder.
      </p>
    </div>
  );
}

/**
 * Settings (14-ui §8.6), at `/settings`: machine config, edited through the API
 * (UI-088). It shows the form once `GET /settings` answers, or, for a config that failed
 * to load, its issues and a way to start again from the defaults.
 */
export function SettingsScreen() {
  const settings = useSettings();
  const [restartRequired, setRestartRequired] = useState(false);
  const brokenIssues = settings.data === undefined ? validationIssuesOf(settings.error) : [];
  return (
    <section className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <h1 className="font-display text-2xl">Settings</h1>
      {restartRequired && <RestartNotice />}
      {settings.isError && brokenIssues.length === 0 && <FailureMessage error={settings.error} />}
      {settings.data !== undefined && (
        <SettingsForm latest={settings.data} onSaved={setRestartRequired} />
      )}
      {brokenIssues.length > 0 && (
        <BrokenConfig issues={brokenIssues} onSaved={setRestartRequired} />
      )}
      {settings.isPending && <p className="text-text-muted">Loading the settings…</p>}
    </section>
  );
}
