import type { PackSummary } from '@mythos/contracts';
import { Link } from 'react-router';
import { usePacks } from '@/api/library';
import { useSettings } from '@/api/settings';
import { FailureMessage } from '@/components/failure-message';
import { NarratorNotice, settingsGate } from '@/features/library/first-start';
import { startablePacks } from './choices';
import { NewCampaignForm } from './new-campaign-form';

/**
 * New campaign (14-ui §8.2), at `/new`: phase 1's minimal form, not the wizard. With no model
 * to narrate it warns and links to settings, but the campaign can still be created (PRV-001).
 */
// Implements PRV-001's warning on the form.
export function NewCampaignScreen() {
  const packs = usePacks();
  const settings = useSettings();
  const narratorMissing = settings.isSuccess && settingsGate(settings.data) !== 'ready';
  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-display text-2xl">New campaign</h1>
      <div className="mt-6 flex flex-col gap-6">
        {narratorMissing && <NarratorNotice />}
        {packs.isPending && <p className="text-text-muted">Opening the packs…</p>}
        {packs.isError && <FailureMessage error={packs.error} />}
        {packs.isSuccess && <PackChoice packs={packs.data} />}
      </div>
    </section>
  );
}

/** The form over the packs that can start a campaign (SCH-102), or why there are none. */
function PackChoice({ packs }: { packs: readonly PackSummary[] }) {
  const [first, ...rest] = startablePacks(packs);
  if (first === undefined) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p>No pack can start a campaign yet. The library lists what needs fixing in each one.</p>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4"
        >
          Go to the library
        </Link>
      </div>
    );
  }
  return <NewCampaignForm packs={[first, ...rest]} />;
}
