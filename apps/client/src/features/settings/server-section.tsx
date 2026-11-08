import { issuesAt } from './field-issues';
import { NumberField, TextField } from './form-fields';
import { Section, type SectionProps } from './section';
import { schemaDefaults } from './schema-defaults';

/**
 * Where the server listens, and the data folder. Each applies only after a restart, and
 * says so (PRV-004). The PIN, which is also under `server`, has its own section.
 */
export function ServerSection({ draft, issues, change }: SectionProps) {
  const defaults = schemaDefaults.config;
  return (
    <Section
      title="Server"
      description="Where Mythos listens for this computer and the other devices on your network."
    >
      <TextField
        notes={{
          label: 'Network address',
          hint: '0.0.0.0 lets other devices on your network connect; 127.0.0.1 allows only this computer.',
          defaultText: defaults.server.host,
          needsRestart: true,
          issues: issuesAt(issues, 'server.host'),
        }}
        value={draft.server.host}
        onChange={(host) => {
          change((d) => ({ ...d, server: { ...d.server, host } }));
        }}
      />
      <NumberField
        notes={{
          label: 'Port',
          defaultText: String(defaults.server.port),
          needsRestart: true,
          issues: issuesAt(issues, 'server.port'),
        }}
        value={draft.server.port}
        onChange={(port) => {
          change((d) => ({ ...d, server: { ...d.server, port: port ?? Number.NaN } }));
        }}
      />
      <TextField
        notes={{
          label: 'Data folder',
          hint: 'Where campaigns, packs, and the library are kept. Leave it blank for the usual folder on this system.',
          needsRestart: true,
          issues: issuesAt(issues, 'dataDir'),
        }}
        value={draft.dataDir ?? ''}
        onChange={(text) => {
          change((d) => ({ ...d, dataDir: text.trim() === '' ? null : text }));
        }}
      />
    </Section>
  );
}
