import type { PackSummary, SemanticIssue } from '@mythos/contracts';
import { CircleAlertIcon } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCreateCampaign } from '@/api/campaigns';
import { validationIssuesOf } from '@/api/validation-issues';
import { FailureMessage } from '@/components/failure-message';
import { Button } from '@/components/ui/button';
import {
  commandFor,
  defaultPackId,
  NAME_MAX_LENGTH,
  optionName,
  premadeScenarios,
  suggestedName,
  type PremadeScenario,
} from './choices';
import { NameField, SelectField } from './form-fields';

/** At least one pack, so the form always has one chosen. */
export type StartablePacks = readonly [PackSummary, ...PackSummary[]];

/** The command's fields the form shows issues at; issues elsewhere go above Start. */
const FIELD_PATHS = new Set(['name', 'packId', 'scenarioId']);

const BLANK_NAME: SemanticIssue = { path: 'name', message: 'Give the campaign a name.' };

/**
 * The phase-1 new-campaign form (14-ui §15): name, pack, scenario, and the premade PC, with the
 * setting's default tone profile and ruleset shown but not editable. Start posts the command
 * and opens the play screen in place of this one, where the opening narration streams.
 */
// Implements UI-123 (the reference pack preselected), SCH-110, and CON-112's issues at fields.
export function NewCampaignForm({ packs }: { packs: StartablePacks }) {
  const choice = useChoice(packs);
  const { pack, scenarios, scenario, name } = choice;
  const [blankName, setBlankName] = useState(false);
  const create = useCreateCampaign();
  const navigate = useNavigate();
  const command = scenario === null ? null : commandFor(name, pack, scenario);

  const issues = blankName ? [BLANK_NAME] : validationIssuesOf(create.error);
  const issuesAt = (path: string) => issues.filter((issue) => issue.path === path);

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (command === null || create.isPending) return;
    setBlankName(command.name === '');
    if (command.name === '') return;
    create.mutate(command, {
      onSuccess: (view) => {
        void navigate(`/c/${encodeURIComponent(view.campaignId)}`, { replace: true });
      },
    });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <NameField
        value={name}
        maxLength={NAME_MAX_LENGTH}
        issues={issuesAt('name')}
        onChange={choice.setName}
      />
      <SelectField
        id="campaign-pack"
        label="Pack"
        value={pack.packId}
        options={packs.map((option) => ({ value: option.packId, label: option.name }))}
        issues={issuesAt('packId')}
        onChange={choice.choosePack}
      />
      <SelectField
        id="campaign-scenario"
        label="Scenario"
        value={scenario?.id}
        options={scenarios.map((option) => ({ value: option.id, label: option.name }))}
        issues={issuesAt('scenarioId')}
        onChange={choice.chooseScenario}
      >
        {scenario !== null && <p className="text-sm text-text-muted">{scenario.description}</p>}
      </SelectField>
      <StartDetails pack={pack} scenario={scenario} />
      <OtherIssues issues={issues.filter((issue) => !FIELD_PATHS.has(issue.path))} />
      {create.isError && issues.length === 0 && <FailureMessage error={create.error} />}
      <div>
        <Button type="submit" size="lg" disabled={command === null || create.isPending}>
          {create.isPending ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </form>
  );
}

/**
 * The pack, scenario, and name chosen so far. The pack starts as the reference pack when it
 * can start a campaign; a new pack starts at its first scenario; the name follows the choices
 * until the player writes one.
 */
function useChoice(packs: StartablePacks) {
  const [packId, setPackId] = useState(() => defaultPackId(packs) ?? packs[0].packId);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState<string | null>(null);
  const pack = packs.find((candidate) => candidate.packId === packId) ?? packs[0];
  const scenarios = premadeScenarios(pack);
  const scenario = scenarios.find((option) => option.id === scenarioId) ?? scenarios[0] ?? null;
  return {
    pack,
    scenarios,
    scenario,
    name: editedName ?? (scenario === null ? '' : suggestedName(pack, scenario)),
    setName: setEditedName,
    choosePack: (next: string) => {
      setPackId(next);
      setScenarioId(null);
    },
    chooseScenario: setScenarioId,
  };
}

/**
 * What the player can't change here: the premade PC, and the setting's tone profile and
 * ruleset. When the pack can't start from this form, it says why (14-ui Decisions).
 */
function StartDetails({ pack, scenario }: { pack: PackSummary; scenario: PremadeScenario | null }) {
  if (scenario === null) {
    return (
      <p>
        Every scenario in this pack needs a character you create, which this form can't do yet.
        Choose another pack.
      </p>
    );
  }
  const toneProfile = optionName(pack.toneProfiles, pack.defaults.toneProfileId);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="text-text-muted">Character</dt>
        <dd>{scenario.premadePc.name}</dd>
        <dt className="text-text-muted">Tone profile</dt>
        <dd>{toneProfile ?? 'None'}</dd>
        <dt className="text-text-muted">Ruleset</dt>
        <dd>{optionName(pack.rulesets, pack.defaults.rulesetId)}</dd>
      </dl>
      {toneProfile === null && (
        <p>
          This pack's setting names no tone profile, so it can't start from this form yet. Choose
          another pack.
        </p>
      )}
    </div>
  );
}

/** Issues the server found away from the form's fields, in one alert above Start. */
function OtherIssues({ issues }: { issues: readonly SemanticIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-l-4 border-l-negative bg-surface p-3"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-negative" />
      <div className="min-w-0">
        <p>This campaign can't start yet:</p>
        <ul className="mt-1 list-disc pl-5">
          {issues.map((issue, index) => (
            <li key={`${String(index)} ${issue.path}`}>{issue.message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
