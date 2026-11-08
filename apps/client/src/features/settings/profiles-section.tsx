import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProfileCard } from './profile-card';
import { Section, type SectionProps } from './section';
import { itemState, newProfile, providerOf, removeItem, replaceItem } from './settings-draft';

/** Every model profile, with its model picker and Probe, and Add a profile. */
export function ProfilesSection({ draft, base, issues, change }: SectionProps) {
  const providerChoices = draft.providers.map((provider) => ({
    value: provider.value.id,
    label: `${provider.value.id} (${provider.value.type})`,
  }));
  return (
    <Section
      title="Model profiles"
      description="Each model Mythos can use, with what it needs to use it well."
      actions={
        <Button
          variant="outline"
          onClick={() => {
            change((d) => ({ ...d, modelProfiles: [...d.modelProfiles, newProfile(d)] }));
          }}
        >
          <PlusIcon aria-hidden />
          Add a model profile
        </Button>
      }
    >
      {draft.modelProfiles.length === 0 && (
        // UI-123: an empty state invites the next action.
        <p>Add a model profile so Mythos can narrate.</p>
      )}
      {draft.modelProfiles.map((item) => {
        const provider = providerOf(draft, item.value.providerId);
        return (
          <ProfileCard
            key={item.key}
            item={item}
            state={itemState(item, base.modelProfiles)}
            provider={provider?.value}
            providerSaved={
              provider !== undefined && itemState(provider, base.providers) === 'saved'
            }
            providerChoices={providerChoices}
            issues={issues}
            onChange={(value) => {
              change((d) => ({
                ...d,
                modelProfiles: replaceItem(d.modelProfiles, item.key, value),
              }));
            }}
            onRemove={() => {
              change((d) => ({ ...d, modelProfiles: removeItem(d.modelProfiles, item.key) }));
            }}
          />
        );
      })}
    </Section>
  );
}
