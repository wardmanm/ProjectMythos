// What POST /campaigns checks before anything is written (CON-112): the command against
// the pack, its ruleset, and phase 1's creation rules, reporting every issue at once.
import {
  type AppError,
  type CreateCampaignCommand,
  err,
  ok,
  type Result,
  type SemanticIssue,
} from '@mythos/contracts';
import type {
  ContentSettings,
  Ruleset,
  Scenario,
  SlotSchemaDefinition,
  Theme,
  ToneProfile,
} from '@mythos/contracts/content';
import type { LoadedPack, OfferedDefinition } from '../content';

/** Phase 1 creates campaigns from a premade PC only (task P1-T17's design notes). */
export const PHASE_8_MESSAGE =
  'Player-created characters and stat conversion arrive with the new-campaign wizard (phase 8).';

/** A theme every install has; a tone profile without a theme uses it (14-ui §3). */
const HOUSE_THEME_ID = 'theme.house';

/** The command's choices, resolved against the pack. */
export type CheckedCommand = {
  scenario: Scenario;
  /** The scenario's opening Markdown (SCH-073). */
  opening: string;
  /** The scenario's premade PC (SCH-113). */
  pcId: string;
  toneProfile: OfferedDefinition<ToneProfile>;
  ruleset: OfferedDefinition<Ruleset>;
  /** The command's theme, else the tone profile's, else the house theme. */
  theme: Theme;
  /** The tone profile's slot schema override, else the setting's (SCH-111). */
  slots: SlotSchemaDefinition;
  /** The command's content settings, else the tone profile's (CSET-020). */
  contentSettings: ContentSettings;
};

const issue = (path: string, message: string): SemanticIssue => ({ path, message });

/** The ruleset the pack's characters are authored against (SCH-114). */
function defaultRulesetId(pack: LoadedPack): string {
  return pack.setting.defaults.rulesetId ?? 'ruleset.standard';
}

function premadePcId(scenario: Scenario): string | null {
  return scenario.pc.mode === 'player-created' ? null : scenario.pc.characterId;
}

/**
 * Every issue with the command, each at its path in the request body (CON-091).
 * Implements CON-112 and SCH-110.
 */
function commandIssues(pack: LoadedPack, command: CreateCampaignCommand): SemanticIssue[] {
  const packId = pack.manifest.id;
  const issues: SemanticIssue[] = [];
  const found = pack.scenarios.find(({ scenario }) => scenario.id === command.scenarioId);
  if (found === undefined) {
    issues.push(issue('scenarioId', `"${command.scenarioId}" is not a scenario in pack ${packId}`));
  }
  if (!pack.toneProfiles.some(({ definition }) => definition.id === command.toneProfileId)) {
    const message = `"${command.toneProfileId}" is not a tone profile pack ${packId} offers`;
    issues.push(issue('toneProfileId', message));
  }
  const themeId = command.themeId;
  if (themeId !== undefined && !pack.themes.some(({ definition }) => definition.id === themeId)) {
    issues.push(issue('themeId', `"${themeId}" is not a theme pack ${packId} offers`));
  }
  const rulesetId = defaultRulesetId(pack);
  if (command.rulesetId !== rulesetId) {
    const message = `campaigns use the setting's default ruleset, ${rulesetId}, for now. ${PHASE_8_MESSAGE}`;
    issues.push(issue('rulesetId', message));
  }
  if (command.pc.mode === 'created') issues.push(issue('pc.mode', PHASE_8_MESSAGE));
  if (command.conversion !== null) issues.push(issue('conversion', PHASE_8_MESSAGE));
  if (
    found !== undefined &&
    command.pc.mode === 'premade' &&
    premadePcId(found.scenario) === null
  ) {
    const message = `${found.scenario.id} has no premade PC. ${PHASE_8_MESSAGE}`;
    issues.push(issue('pc.mode', message));
  }
  return issues;
}

// The pack loaded with no issues and the command checked out, so a gap here is a defect.
function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`checkCommand: no ${what}`);
  return value;
}

/**
 * The command's choices resolved against `pack`, or `validation_failed` with every issue
 * in `details.issues`. Implements CON-112 and SCH-110.
 */
export function checkCommand(
  pack: LoadedPack,
  command: CreateCampaignCommand,
): Result<CheckedCommand, AppError> {
  const issues = commandIssues(pack, command);
  if (issues.length > 0) {
    const count = issues.length === 1 ? '1 problem' : `${String(issues.length)} problems`;
    const message = `The campaign was not created: ${count}.`;
    return err({ code: 'validation_failed', message, details: { issues } });
  }
  const found = present(
    pack.scenarios.find(({ scenario }) => scenario.id === command.scenarioId),
    command.scenarioId,
  );
  const toneProfile = present(
    pack.toneProfiles.find(({ definition }) => definition.id === command.toneProfileId),
    command.toneProfileId,
  );
  const ruleset = present(
    pack.rulesets.find(({ definition }) => definition.id === command.rulesetId),
    command.rulesetId,
  );
  // Implements UI-030 for a new campaign: its own theme, else the tone profile's, else the house's.
  const themeId = command.themeId ?? toneProfile.definition.themeId ?? HOUSE_THEME_ID;
  const slotSchemaId = toneProfile.definition.slotSchemaId ?? pack.setting.slotSchemaId;
  return ok({
    scenario: found.scenario,
    opening: found.opening,
    pcId: present(premadePcId(found.scenario), `premade PC in ${found.scenario.id}`),
    toneProfile,
    ruleset,
    theme: present(
      pack.themes.find(({ definition }) => definition.id === themeId),
      themeId,
    ).definition,
    slots: present(pack.slotSchemas[slotSchemaId], slotSchemaId),
    contentSettings: command.contentSettings ?? toneProfile.definition.content,
  });
}
