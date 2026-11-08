import type { CampaignSummary, MachineConfig } from '@mythos/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useCampaigns } from '@/api/campaigns';
import { usePacks } from '@/api/library';
import { useSettings } from '@/api/settings';
import { FailureMessage } from '@/components/failure-message';
import { buttonVariants } from '@/components/ui/button';
import { CampaignCard } from './campaign-card';
import { DeleteCampaignDialog } from './delete-campaign-dialog';
import { NarratorNotice, settingsGate, type SettingsGate } from './first-start';
import { PackErrors } from './pack-errors';

/**
 * What the machine config asks of the library, once it is known (PRV-001). Only an answer
 * fetched since the library opened counts: a config cached before the player saved a profile
 * would send them straight back to settings (14-ui Traps). A config that can't be read asks
 * nothing, so the library shows as usual; `auth_required` has already gone to the PIN screen.
 */
function libraryGate(settings: UseQueryResult<MachineConfig>): SettingsGate | 'waiting' {
  if (!settings.isFetchedAfterMount) return 'waiting';
  return settings.isSuccess ? settingsGate(settings.data) : 'ready';
}

/**
 * The library (14-ui §8.1), at `/`. While no model profile exists it opens settings instead,
 * replacing the address so Back doesn't return here (PRV-001). Otherwise: the narrator notice
 * if nothing narrates, the campaigns in the server's order, most recently played first, and
 * the packs with errors.
 */
// Implements UI-083 and PRV-001.
export function LibraryScreen() {
  const settings = useSettings();
  const campaigns = useCampaigns();
  const packs = usePacks();
  const gate = libraryGate(settings);
  if (gate === 'open-settings') return <Navigate to="/settings" replace />;

  const loading = gate === 'waiting' || campaigns.isPending;
  const hasCampaigns = !loading && campaigns.data !== undefined && campaigns.data.length > 0;
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl">Library</h1>
        {hasCampaigns && (
          <Link to="/new" className={buttonVariants()}>
            New campaign
          </Link>
        )}
      </div>
      {loading ? (
        <p className="mt-4 text-text-muted">Opening the library…</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {gate === 'narrator-unassigned' && <NarratorNotice />}
          {campaigns.isError && <FailureMessage error={campaigns.error} />}
          {campaigns.data !== undefined && <CampaignList campaigns={campaigns.data} />}
          {packs.data !== undefined && <PackErrors packs={packs.data} />}
        </div>
      )}
    </section>
  );
}

/**
 * The campaigns as one column on phones and a grid from 640 px, or the empty state. The
 * delete dialog sits outside both, so deleting the last campaign doesn't unmount it before it
 * reports.
 */
function CampaignList({ campaigns }: { campaigns: readonly CampaignSummary[] }) {
  const [deleting, setDeleting] = useState<CampaignSummary | null>(null);
  return (
    <>
      {campaigns.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <ul aria-label="Campaigns" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <li key={campaign.campaignId}>
              <CampaignCard campaign={campaign} onDelete={setDeleting} />
            </li>
          ))}
        </ul>
      )}
      {deleting !== null && (
        <DeleteCampaignDialog
          campaign={deleting}
          onClose={() => {
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

/**
 * An empty library invites the first campaign. The form preselects the reference pack, so the
 * link needs nothing more.
 */
// Implements UI-123.
function EmptyLibrary() {
  return (
    <div className="flex flex-col items-start gap-3">
      <p>You have no campaigns yet.</p>
      <Link to="/new" className={buttonVariants({ size: 'lg' })}>
        Start your first campaign
      </Link>
    </div>
  );
}
