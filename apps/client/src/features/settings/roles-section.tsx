import { ModelRoleSchema, type MachineConfig, type ModelRole } from '@mythos/contracts';
import { issuesAt } from './field-issues';
import { ChoiceField } from './form-fields';
import { Section, type SectionProps } from './section';
import type { SettingsDraft } from './settings-draft';

type Roles = MachineConfig['roles'];
type Assignment = Roles[ModelRole];

/**
 * Radix's Select has no empty value, so "unassigned" needs one of its own: one no profile
 * id can be, since ids are lowercase slugs.
 */
const UNASSIGNED = '(unassigned)';

const roleNotes = {
  narrator: { label: 'Narrator', hint: 'Writes the narration.' },
  adjudicator: { label: 'Adjudicator', hint: 'Decides whether a roll is needed, and rules.' },
  'npc-voice': { label: 'NPC voice', hint: 'Voices key NPCs in calls of their own.' },
  extractor: {
    label: 'Extractor',
    hint: 'Records what happened as observations and state changes.',
  },
  consolidator: { label: 'Consolidator', hint: 'Sums up old, minor observations.' },
  'world-ticker': { label: 'World ticker', hint: 'Moves NPCs and factions off-screen.' },
  embedder: { label: 'Embedder', hint: 'Finds related memories. Needs an embedding profile.' },
  illustrator: { label: 'Illustrator', hint: 'Writes image prompts.' },
  'speech-segmenter': {
    label: 'Speech segmenter',
    hint: 'Splits narration by speaker, for character voices.',
  },
} as const satisfies Record<ModelRole, { label: string; hint: string }>;

function fallback(words: string, assignment: Assignment): string {
  return assignment === null ? words : `${words} (${assignment.profileId})`;
}

/**
 * What an unassigned role does: `npc-voice` and `speech-segmenter` fall back to another
 * role's profile, `illustrator` to templates, and every other role is unassigned, so its
 * calls fail with `not_configured`. Implements PRV-001, PRV-009, and PRV-015 on the
 * settings screen.
 */
export function unassignedWords(role: ModelRole, roles: Roles): string {
  switch (role) {
    case 'npc-voice':
      return fallback("Use the narrator's", roles.narrator);
    case 'speech-segmenter':
      return fallback("Use the extractor's", roles.extractor);
    case 'illustrator':
      return 'Image prompts from templates only';
    default:
      return 'Unassigned';
  }
}

/**
 * The profiles a role may use. PRV-002 wants an embedding profile for the embedder and a
 * text profile for every other role; the current value is offered even when it breaks
 * that, and the save reports it.
 */
function choicesFor(role: ModelRole, draft: SettingsDraft) {
  const kind = role === 'embedder' ? 'embedding' : 'text';
  const profiles = draft.modelProfiles
    .map((item) => item.value)
    .filter((profile) => profile.kind === kind)
    .map((profile) => ({ value: profile.id, label: `${profile.id} (${profile.model})` }));
  return [{ value: UNASSIGNED, label: unassignedWords(role, draft.roles) }, ...profiles];
}

/** The role's assignment after a choice. A role's own sampling is kept as it was. */
function assigned(current: Assignment, choice: string): Assignment {
  if (choice === UNASSIGNED) return null;
  return current === null ? { profileId: choice } : { ...current, profileId: choice };
}

/** One profile picker per model role, each saying what happens when it is empty. */
export function RolesSection({ draft, issues, change }: SectionProps) {
  return (
    <Section
      title="Roles"
      description="Which profile does each job. Changes apply from the next model call."
    >
      {draft.roles.narrator === null && (
        // UI-123: an empty state invites the next action.
        <p>Assign the narrator to start playing.</p>
      )}
      {ModelRoleSchema.options.map((role) => (
        <ChoiceField
          key={role}
          notes={{ ...roleNotes[role], issues: issuesAt(issues, `roles.${role}`) }}
          value={draft.roles[role]?.profileId ?? UNASSIGNED}
          choices={choicesFor(role, draft)}
          onChange={(choice) => {
            change((d) => ({
              ...d,
              roles: { ...d.roles, [role]: assigned(d.roles[role], choice) },
            }));
          }}
        />
      ))}
    </Section>
  );
}
