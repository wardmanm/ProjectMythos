// Pass 2 of SCH-100: every reference resolves. Definition IDs go through the lookup order
// (SCH-010); entity IDs must name an entity of the right kind in the pack.
import type { AuthoredEntity, ToneProfile } from '@mythos/contracts/content';
import { defaultRulesetId } from './resolve';
import type { DefinitionSet, EntityFile, PackContent, PackIssue } from './types';
import { withArticle } from './validate-files';

type Kind = AuthoredEntity['kind'];
type Entities = PackContent['entities'];

const CHARACTER: readonly Kind[] = ['pc', 'npc'];
const ACTOR: readonly Kind[] = ['pc', 'npc', 'faction'];
const PLACE: readonly Kind[] = ['place'];

/** An entity reference: null and absent are fine, anything else must be an entity of `kinds`. */
function need(
  entities: Entities,
  file: string,
  path: string,
  id: string | null | undefined,
  kinds: readonly Kind[],
): PackIssue[] {
  if (id === null || id === undefined) return [];
  const kind = entities.get(id)?.entity.kind;
  if (kind === undefined) return [{ file, path, message: `"${id}" is not an entity in this pack` }];
  if (kinds.includes(kind)) return [];
  const expected = kinds.map(withArticle).join(' or ');
  return [{ file, path, message: `"${id}" is ${withArticle(kind)}; expected ${expected}` }];
}

function needEach(
  entities: Entities,
  file: string,
  path: string,
  ids: readonly string[],
  kinds: readonly Kind[],
): PackIssue[] {
  return ids.flatMap((id, index) => need(entities, file, `${path}.${String(index)}`, id, kinds));
}

function needDefinition(
  entries: ReadonlyMap<string, unknown>,
  where: { file: string; path: string; id: string; what: string; sources: string },
): PackIssue[] {
  if (entries.has(where.id)) return [];
  return [
    {
      file: where.file,
      path: where.path,
      message: `"${where.id}" is not ${where.what} in ${where.sources}`,
    },
  ];
}

/**
 * A tone profile's theme and slot schema resolve in `definitions`. `sources` names where
 * they were looked for, for the message. Implements SCH-010.
 */
export function toneProfileReferences(
  file: string,
  tone: ToneProfile,
  definitions: DefinitionSet,
  sources: string,
): PackIssue[] {
  const issues: PackIssue[] = [];
  if (tone.themeId !== undefined) {
    const where = { file, path: 'themeId', id: tone.themeId, what: 'a theme', sources };
    issues.push(...needDefinition(definitions.themes, where));
  }
  if (tone.slotSchemaId !== undefined) {
    const where = {
      file,
      path: 'slotSchemaId',
      id: tone.slotSchemaId,
      what: 'a slot schema',
      sources,
    };
    issues.push(...needDefinition(definitions.slotSchemas, where));
  }
  return issues;
}

const PACK_AND_LIBRARIES = 'the pack or the libraries';

function settingReferences(content: PackContent): PackIssue[] {
  const { setting, definitions } = content;
  if (setting === null) return [];
  const file = 'setting.json';
  const check = (entries: ReadonlyMap<string, unknown>, path: string, id: string, what: string) =>
    needDefinition(entries, { file, path, id, what, sources: PACK_AND_LIBRARIES });
  const toneProfileId = setting.defaults.toneProfileId;
  return [
    ...check(definitions.calendars, 'calendarId', setting.calendarId, 'a calendar'),
    ...check(definitions.slotSchemas, 'slotSchemaId', setting.slotSchemaId, 'a slot schema'),
    ...(toneProfileId === undefined
      ? []
      : check(definitions.toneProfiles, 'defaults.toneProfileId', toneProfileId, 'a tone profile')),
    ...check(definitions.rulesets, 'defaults.rulesetId', defaultRulesetId(setting), 'a ruleset'),
    ...setting.scenarioIds.flatMap((id, index) =>
      content.scenarios.has(id)
        ? []
        : [
            {
              file,
              path: `scenarioIds.${String(index)}`,
              message: `"${id}" has no file in scenarios/`,
            },
          ],
    ),
  ];
}

// Implements SCH-070 (entities exist) and SCH-071 (a premade PC is a pc).
function scenarioReferences(content: PackContent): PackIssue[] {
  const { entities } = content;
  return [...content.scenarios.values()].flatMap(({ file, value: scenario }) => [
    ...need(entities, file, 'startPlaceId', scenario.startPlaceId, PLACE),
    ...needEach(entities, file, 'presentEntityIds', scenario.presentEntityIds, CHARACTER),
    ...(scenario.pc.mode === 'player-created'
      ? []
      : need(entities, file, 'pc.characterId', scenario.pc.characterId, ['pc'])),
    ...(content.sources.pack.files.has(scenario.openingFile)
      ? []
      : [
          {
            file,
            path: 'openingFile',
            message: `"${scenario.openingFile}" is not a file in the pack`,
          },
        ]),
  ]);
}

function entityReferences(entities: Entities, { file, entity }: EntityFile): PackIssue[] {
  switch (entity.kind) {
    case 'pc':
    case 'npc':
      return need(entities, file, 'startingLocationId', entity.startingLocationId, PLACE);
    case 'place':
      return need(entities, file, 'parentPlaceId', entity.parentPlaceId, PLACE);
    case 'faction':
      return [];
    case 'item': {
      const location = entity.startingLocation;
      const at = 'startingLocation';
      const issues = need(entities, file, 'ownerId', entity.ownerId, ACTOR);
      if ('characterId' in location) {
        issues.push(...need(entities, file, `${at}.characterId`, location.characterId, CHARACTER));
      }
      if (location.type === 'placed') {
        issues.push(...need(entities, file, `${at}.placeId`, location.placeId, PLACE));
      }
      if (location.type === 'contained') {
        issues.push(...need(entities, file, `${at}.containerId`, location.containerId, ['item']));
      }
      return issues;
    }
  }
}

// Implements SCH-090: aboutRef names an entry in the same file.
function historyReferences(content: PackContent): PackIssue[] {
  const { history, entities } = content;
  if (history === null) return [];
  const { file } = history;
  const refs = new Set(history.value.map((entry) => entry.ref));
  return history.value.flatMap((entry, index) => {
    const at = `entries.${String(index)}`;
    const issues = [
      ...need(entities, file, `${at}.placeId`, entry.placeId, PLACE),
      ...needEach(entities, file, `${at}.actorIds`, entry.actorIds, ACTOR),
      ...needEach(entities, file, `${at}.witnessIds`, entry.witnessIds, CHARACTER),
      ...entry.alsoKnownBy.flatMap((knower, knowerIndex) =>
        need(
          entities,
          file,
          `${at}.alsoKnownBy.${String(knowerIndex)}.entityId`,
          knower.entityId,
          CHARACTER,
        ),
      ),
    ];
    const claim = entry.claim;
    if (claim !== undefined) {
      issues.push(...need(entities, file, `${at}.claim.sourceId`, claim.sourceId, CHARACTER));
      issues.push(
        ...needEach(entities, file, `${at}.claim.audienceIds`, claim.audienceIds, CHARACTER),
      );
      if (claim.aboutRef !== null && !refs.has(claim.aboutRef)) {
        const message = `"${claim.aboutRef}" is not the ref of an entry in this file`;
        issues.push({ file, path: `${at}.claim.aboutRef`, message });
      }
    }
    return issues;
  });
}

// Implements SCH-092's endpoints: relationships run between characters (CON-073).
function relationshipReferences(content: PackContent): PackIssue[] {
  const { relationships, entities } = content;
  if (relationships === null) return [];
  const { file } = relationships;
  return relationships.value.flatMap((relationship, index) => [
    ...need(
      entities,
      file,
      `relationships.${String(index)}.fromId`,
      relationship.fromId,
      CHARACTER,
    ),
    ...need(entities, file, `relationships.${String(index)}.toId`, relationship.toId, CHARACTER),
  ]);
}

/** Pass 2: every reference in the pack's own files. Implements SCH-100's second pass. */
export function referenceIssues(content: PackContent): PackIssue[] {
  const packTones = [...content.definitions.toneProfiles.values()].filter(
    (entry) => entry.source === 'pack',
  );
  return [
    ...settingReferences(content),
    ...packTones.flatMap((entry) =>
      entry.definition === null
        ? []
        : toneProfileReferences(
            entry.file,
            entry.definition,
            content.definitions,
            PACK_AND_LIBRARIES,
          ),
    ),
    ...scenarioReferences(content),
    ...[...content.entities.values()].flatMap((file) => entityReferences(content.entities, file)),
    ...historyReferences(content),
    ...relationshipReferences(content),
  ];
}
