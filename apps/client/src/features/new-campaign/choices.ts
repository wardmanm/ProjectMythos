// The phase-1 new-campaign form's choices (14-ui §15): a pack, a scenario with a premade PC,
// and the setting's default tone profile and ruleset. The full wizard is phase 8 (UI-084).
import type { CreateCampaignCommand, PackSummary } from '@mythos/contracts';

export type ScenarioOption = PackSummary['scenarios'][number];
export type PremadeScenario = ScenarioOption & {
  premadePc: NonNullable<ScenarioOption['premadePc']>;
};

/** The pack an empty library's link opens with (UI-123). */
export const REFERENCE_PACK_ID = 'reference';

/** The longest name `CreateCampaignCommand` takes. */
export const NAME_MAX_LENGTH = 80;

// Implements SCH-102: a pack with any issue cannot start a campaign.
export function startablePacks(packs: readonly PackSummary[]): PackSummary[] {
  return packs.filter((pack) => pack.issues.length === 0);
}

// Implements UI-123: the reference pack is preselected whenever it can start a campaign.
export function defaultPackId(startable: readonly PackSummary[]): string | null {
  const reference = startable.find((pack) => pack.packId === REFERENCE_PACK_ID);
  return reference?.packId ?? startable[0]?.packId ?? null;
}

/** The scenarios phase 1 can start: those with a premade PC (`premade` or `either`). */
export function premadeScenarios(pack: PackSummary): PremadeScenario[] {
  return pack.scenarios.filter(
    (scenario): scenario is PremadeScenario => scenario.premadePc !== null,
  );
}

/** "<setting>: <scenario>", the name a campaign gets unless the player writes another. */
export function suggestedName(pack: PackSummary, scenario: ScenarioOption): string {
  return `${pack.settingName ?? pack.name}: ${scenario.name}`.slice(0, NAME_MAX_LENGTH).trim();
}

/** The name of one of the pack's tone profiles or rulesets, or its ID if the pack lacks it. */
export function optionName(
  options: readonly { id: string; name: string }[],
  id: string | null,
): string | null {
  if (id === null) return null;
  return options.find((option) => option.id === id)?.name ?? id;
}

/**
 * The command for the chosen pack and scenario, with the setting's default tone profile and
 * ruleset and the scenario's premade PC (SCH-110). Null when the setting names no tone
 * profile: phase 1's form has no tone profile to offer instead (14-ui Decisions).
 */
// Implements SCH-110: a pack, a scenario, a tone profile, a ruleset, and the premade PC.
export function commandFor(
  name: string,
  pack: PackSummary,
  scenario: PremadeScenario,
): CreateCampaignCommand | null {
  const { toneProfileId, rulesetId } = pack.defaults;
  if (toneProfileId === null) return null;
  return {
    name: name.trim(),
    packId: pack.packId,
    scenarioId: scenario.id,
    toneProfileId,
    rulesetId,
    conversion: null,
    pc: { mode: 'premade' },
  };
}
