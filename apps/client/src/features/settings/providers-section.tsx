import type { ProviderConfig } from '@mythos/contracts';
import { PlusIcon, RefreshCwIcon } from 'lucide-react';
import { useProviderStatuses } from '@/api/settings';
import { Button } from '@/components/ui/button';
import type { HealthView } from './health-dot';
import { ProviderCard } from './provider-card';
import { Section, type SectionProps } from './section';
import {
  itemState,
  newProvider,
  removeItem,
  replaceItem,
  type ItemState,
  type Keyed,
} from './settings-draft';

type Statuses = ReturnType<typeof useProviderStatuses>;

/**
 * A provider's health as the screen can know it. The server checks the saved config, so a
 * new or changed provider says to save first rather than show a stale status (PRV-091).
 */
function healthOf(item: Keyed<ProviderConfig>, state: ItemState, statuses: Statuses): HealthView {
  if (state !== 'saved') return { kind: 'unsaved' };
  if (statuses.isFetching) return { kind: 'checking' };
  const status = statuses.data?.find((candidate) => candidate.providerId === item.value.id);
  return status === undefined ? { kind: 'unknown' } : { kind: 'checked', health: status.health };
}

/** Every provider, each with its health (PRV-091), and Add a provider. */
export function ProvidersSection({ draft, base, issues, change }: SectionProps) {
  const statuses = useProviderStatuses();
  const deviceChoices = draft.devices.map((device) => ({
    value: device.value.id,
    label: device.value.name === '' ? device.value.id : `${device.value.name} (${device.value.id})`,
  }));
  return (
    <Section
      title="Providers"
      description="The model servers and services Mythos can call."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={statuses.isFetching}
            onClick={() => {
              void statuses.refetch();
            }}
          >
            <RefreshCwIcon aria-hidden />
            Check again
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              change((d) => ({ ...d, providers: [...d.providers, newProvider(d)] }));
            }}
          >
            <PlusIcon aria-hidden />
            Add a provider
          </Button>
        </div>
      }
    >
      {draft.providers.map((item) => {
        const state = itemState(item, base.providers);
        return (
          <ProviderCard
            key={item.key}
            item={item}
            state={state}
            saved={base.providers.find((candidate) => candidate.key === item.key)?.value}
            deviceChoices={deviceChoices}
            health={healthOf(item, state, statuses)}
            issues={issues}
            onChange={(value) => {
              change((d) => ({ ...d, providers: replaceItem(d.providers, item.key, value) }));
            }}
            onRemove={() => {
              change((d) => ({ ...d, providers: removeItem(d.providers, item.key) }));
            }}
          />
        );
      })}
    </Section>
  );
}
