import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addressOf, issuesAt, issuesExactlyAt } from './field-issues';
import { NumberField, TextField } from './form-fields';
import { schemaDefaults } from './schema-defaults';
import { idHint, ItemCard, Section, type SectionProps } from './section';
import {
  itemState,
  newDevice,
  removeItem,
  replaceItem,
  type Device,
  type ItemState,
  type Keyed,
} from './settings-draft';

/** The compute resources jobs run on; jobs on one device take turns (ARCH-081). */
export function DevicesSection({ draft, base, issues, change }: SectionProps) {
  return (
    <Section
      title="Devices"
      description="Each computer or cloud service that runs models. Jobs on one device take turns."
      actions={
        <Button
          variant="outline"
          onClick={() => {
            change((d) => ({ ...d, devices: [...d.devices, newDevice(d)] }));
          }}
        >
          <PlusIcon aria-hidden />
          Add a device
        </Button>
      }
    >
      {draft.devices.map((item) => (
        <DeviceCard
          key={item.key}
          item={item}
          state={itemState(item, base.devices)}
          issues={issues}
          onChange={(value) => {
            change((d) => ({ ...d, devices: replaceItem(d.devices, item.key, value) }));
          }}
          onRemove={() => {
            change((d) => ({ ...d, devices: removeItem(d.devices, item.key) }));
          }}
        />
      ))}
    </Section>
  );
}

function DeviceCard({
  item,
  state,
  issues,
  onChange,
  onRemove,
}: {
  item: Keyed<Device>;
  state: ItemState;
  issues: SectionProps['issues'];
  onChange: (value: Device) => void;
  onRemove: () => void;
}) {
  const device = item.value;
  const saved = state !== 'new';
  const at = (field: string) => issuesAt(issues, addressOf('devices', item.key, field));
  return (
    <ItemCard
      title={`Device ${device.id}`}
      state={state}
      issues={issuesExactlyAt(issues, addressOf('devices', item.key))}
      removeLabel={`Remove device ${device.id}`}
      onRemove={onRemove}
    >
      <TextField
        notes={{ label: 'Identifier', hint: idHint(saved), issues: at('id') }}
        value={device.id}
        readOnly={saved}
        onChange={(id) => {
          onChange({ ...device, id });
        }}
      />
      <TextField
        notes={{ label: 'Name', issues: at('name') }}
        value={device.name}
        onChange={(name) => {
          onChange({ ...device, name });
        }}
      />
      <NumberField
        notes={{
          label: 'Jobs at once',
          hint: 'How many model calls this device runs together.',
          defaultText: String(schemaDefaults.device.concurrency),
          issues: at('concurrency'),
        }}
        value={device.concurrency}
        onChange={(concurrency) => {
          onChange({ ...device, concurrency: concurrency ?? Number.NaN });
        }}
      />
    </ItemCard>
  );
}
