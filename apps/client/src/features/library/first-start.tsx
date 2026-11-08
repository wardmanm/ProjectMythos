import type { MachineConfig } from '@mythos/contracts';
import { InfoIcon } from 'lucide-react';
import { Link } from 'react-router';

/**
 * What the machine config asks of the library before play (PRV-001):
 * - `open-settings`: no model profile exists, so the settings screen opens instead;
 * - `narrator-unassigned`: profiles exist, but nothing narrates, so a notice links to settings;
 * - `ready`: the narrator has a model.
 */
export type SettingsGate = 'open-settings' | 'narrator-unassigned' | 'ready';

// Implements PRV-001: with no model profile, the client opens settings instead of the library.
export function settingsGate(config: MachineConfig): SettingsGate {
  if (config.modelProfiles.length === 0) return 'open-settings';
  if (config.roles.narrator === null) return 'narrator-unassigned';
  return 'ready';
}

/**
 * Says that no model narrates yet and links to settings: UI-084's review warning, early. The
 * words carry the meaning; the icon and the accent only add to them (UI-114).
 */
export function NarratorNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-l-4 border-l-accent bg-surface p-3">
      <InfoIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0">
        <p>No model is assigned to narrate. Assign one in Settings before you play.</p>
        <Link
          to="/settings"
          className="inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4"
        >
          Open settings
        </Link>
      </div>
    </div>
  );
}
