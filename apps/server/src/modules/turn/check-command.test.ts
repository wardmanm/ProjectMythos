import { existsSync } from 'node:fs';
import { SemanticIssueSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { LoadedPack } from '../content';
import { checkCommand, PHASE_8_MESSAGE } from './check-command';
import { createCampaign } from './create-campaign';
import { arrivalCommand, createTestSpace } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

async function referencePack(): Promise<LoadedPack> {
  const loaded = await space.deps().content.loadPack('reference');
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
  return loaded.value;
}

/** The issues of a refused command, parsed as the client would (CON-091). */
function issuesOf(
  result: Awaited<ReturnType<typeof createCampaign>> | ReturnType<typeof checkCommand>,
) {
  if (result.ok) throw new Error('expected the command to be refused');
  expect(result.error.code).toBe('validation_failed');
  const { issues } = result.error.details as { issues: unknown[] };
  return issues.map((found) => SemanticIssueSchema.parse(found));
}

describe('checkCommand', () => {
  it('CON-112: a command with an unknown scenario and a missing tone profile reports both, and nothing is written', async () => {
    const deps = space.deps();
    const command = arrivalCommand({
      scenarioId: 'scenario.departure',
      toneProfileId: 'tone.missing',
    });
    expect(issuesOf(await createCampaign(deps, command))).toEqual([
      { path: 'scenarioId', message: '"scenario.departure" is not a scenario in pack reference' },
      {
        path: 'toneProfileId',
        message: '"tone.missing" is not a tone profile pack reference offers',
      },
    ]);
    expect(existsSync(deps.store.campaignsDir)).toBe(false);
  });

  it('CON-112: an unknown pack is refused at packId', async () => {
    const result = await createCampaign(space.deps(), arrivalCommand({ packId: 'elsewhere' }));
    expect(issuesOf(result)).toEqual([
      { path: 'packId', message: 'There is no pack "elsewhere".' },
    ]);
  });

  it('CON-112: a theme the pack does not offer is refused at themeId', async () => {
    const result = checkCommand(await referencePack(), arrivalCommand({ themeId: 'theme.neon' }));
    expect(issuesOf(result)).toEqual([
      { path: 'themeId', message: '"theme.neon" is not a theme pack reference offers' },
    ]);
  });

  it('SCH-110: a player-created PC and a stat conversion are refused until phase 8, each at its path', async () => {
    const result = checkCommand(
      await referencePack(),
      arrivalCommand({
        pc: {
          mode: 'created',
          name: 'Ada',
          ageCategory: 'adult',
          stats: { str: 3, end: 3, dex: 3, int: 3, cha: 3 },
          physicalDescription: '',
          personality: 'Curious.',
        },
        conversion: { stats: {}, harmTags: {} },
      }),
    );
    expect(issuesOf(result)).toEqual([
      { path: 'pc.mode', message: PHASE_8_MESSAGE },
      { path: 'conversion', message: PHASE_8_MESSAGE },
    ]);
    expect(PHASE_8_MESSAGE).toBe(
      'Player-created characters and stat conversion arrive with the new-campaign wizard (phase 8).',
    );
  });

  it("SCH-110: a ruleset other than the setting's default is refused", async () => {
    const result = checkCommand(
      await referencePack(),
      arrivalCommand({ rulesetId: 'ruleset.d20' }),
    );
    expect(issuesOf(result)).toEqual([
      {
        path: 'rulesetId',
        message: `campaigns use the setting's default ruleset, ruleset.standard, for now. ${PHASE_8_MESSAGE}`,
      },
    ]);
  });

  it('SCH-110: a scenario with no premade PC is refused for a premade command', async () => {
    const pack = await referencePack();
    const [arrival] = pack.scenarios;
    if (arrival === undefined) throw new Error('no scenario');
    const playerMade = {
      ...pack,
      scenarios: [
        {
          ...arrival,
          scenario: { ...arrival.scenario, pc: { mode: 'player-created' as const, concept: '' } },
        },
      ],
    };
    expect(issuesOf(checkCommand(playerMade, arrivalCommand()))).toEqual([
      { path: 'pc.mode', message: `scenario.arrival has no premade PC. ${PHASE_8_MESSAGE}` },
    ]);
  });

  it("SCH-110, CSET-020: a valid command resolves to the scenario's PC, the tone profile's theme and settings, and its slot schema", async () => {
    const pack = await referencePack();
    const result = checkCommand(pack, arrivalCommand());
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const tone = pack.toneProfiles.find(
      ({ definition }) => definition.id === 'tone.coastal-mystery',
    );
    expect(result.value).toMatchObject({
      pcId: 'pc.wren',
      theme: { id: 'theme.brine' },
      slots: { id: 'slots.everyday' },
      contentSettings: tone?.definition.content,
    });
  });

  it("UI-030: a new campaign's theme is the command's, else the tone profile's, else the house theme", async () => {
    const pack = await referencePack();
    const themeOf = (from: LoadedPack, themeId?: string) => {
      const result = checkCommand(from, arrivalCommand(themeId === undefined ? {} : { themeId }));
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.value.theme.id;
    };
    expect(themeOf(pack, 'theme.hearth')).toBe('theme.hearth');
    expect(themeOf(pack)).toBe('theme.brine');
    const unthemed = {
      ...pack,
      toneProfiles: pack.toneProfiles.map((offered) => ({
        ...offered,
        definition: { ...offered.definition, themeId: undefined },
      })),
    };
    expect(themeOf(unthemed)).toBe('theme.house');
  });
});
