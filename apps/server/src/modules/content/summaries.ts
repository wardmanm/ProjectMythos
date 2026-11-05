// What the library screen shows of each pack (03-contracts §14), built from whatever parsed so
// a broken pack is still listed with its issues (SCH-102), and the themes it can offer (UI-031).
import type { PackSummary } from '@mythos/contracts';
import type { Theme } from '@mythos/contracts/content';
import { themeIssues } from '@mythos/core';
import { defaultRulesetId, usableDefinitions } from './resolve';
import type { DefinitionEntry, PackContent, PackIssue, SourceFiles } from './types';
import { parseDefinitions, type SourceLabel } from './validate-files';

type Option = { id: string; name: string; description: string };

function options<T extends Option>(entries: ReadonlyMap<string, DefinitionEntry<T>>): Option[] {
  return usableDefinitions(entries).map(({ definition }) => ({
    id: definition.id,
    name: definition.name,
    description: definition.description,
  }));
}

/** The scenarios the setting lists, in its order, or every one that parsed without a setting. */
function scenarioOptions(content: PackContent): PackSummary['scenarios'] {
  const ids = content.setting?.scenarioIds ?? [...content.scenarios.keys()];
  return ids.flatMap((id) => {
    const scenario = content.scenarios.get(id)?.value;
    if (scenario === undefined) return [];
    const characterId = scenario.pc.mode === 'player-created' ? null : scenario.pc.characterId;
    const premade = characterId === null ? undefined : content.entities.get(characterId)?.entity;
    return [
      {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        pcMode: scenario.pc.mode,
        premadePc: premade?.kind === 'pc' ? { id: premade.id, name: premade.name } : null,
      },
    ];
  });
}

/**
 * A pack's summary for the library screen: its own options, then the libraries' (SCH-010),
 * and every issue, which blocks campaign creation. Implements SCH-102.
 */
export function packSummary(content: PackContent, issues: readonly PackIssue[]): PackSummary {
  const { manifest, setting } = content;
  return {
    packId: content.packId,
    name: manifest?.name ?? content.packId,
    version: manifest?.version ?? '',
    description: manifest?.description ?? '',
    settingName: setting?.name ?? null,
    scenarios: scenarioOptions(content),
    toneProfiles: options(content.definitions.toneProfiles),
    rulesets: options(content.definitions.rulesets),
    defaults: {
      toneProfileId: setting?.defaults.toneProfileId ?? null,
      rulesetId: defaultRulesetId(setting),
    },
    issues: [...issues],
  };
}

/**
 * Every theme that can be applied (UI-031), from the sources in the order given (the built-in
 * library, the user library, then each pack by ID). The first theme with an ID wins.
 */
export function listedThemes(
  sources: readonly { files: SourceFiles; label: SourceLabel }[],
): Theme[] {
  const themes = new Map<string, Theme>();
  for (const { files, label } of sources) {
    const { set, issues } = parseDefinitions(files, label);
    const failed = new Set(issues.map((issue) => issue.file));
    for (const entry of set.themes.values()) {
      const theme = entry.definition;
      if (theme === null || themes.has(entry.id)) continue;
      if (entry.files.some((file) => failed.has(file)) || themeIssues(theme).length > 0) continue;
      themes.set(entry.id, theme);
    }
  }
  return [...themes.values()];
}
