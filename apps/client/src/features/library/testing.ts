// Library and pack data for the library and new-campaign tests, parsed with the contract
// schemas so it cannot drift from them. Not imported by production code.
import {
  CampaignSummarySchema,
  PackSummarySchema,
  type CampaignSummary,
  type PackSummary,
} from '@mythos/contracts';
import { campaignId, otherCampaignId } from '@/test/fixtures';

export { campaignId, otherCampaignId };

/** One campaign as `GET /campaigns` lists it. */
export function campaignSummary(changes: Partial<CampaignSummary> = {}): CampaignSummary {
  return CampaignSummarySchema.parse({
    campaignId,
    name: 'Brinemoor: Arrival',
    settingName: 'Brinemoor',
    gameTimeLabel: 'Monday, October 12, 1874, evening',
    lastPlayedAt: '2026-11-05T10:00:00Z',
    themeId: 'theme.house',
    contentSettings: {
      violence: 'moderate',
      gore: 'fade-to-black',
      sexual: 'off',
      language: 'moderate',
      disturbing: 'moderate',
      lines: [],
      veils: [],
    },
    ...changes,
  });
}

/** The reference pack as `GET /packs` lists it: one `either` scenario, Wren as its premade PC. */
export function referencePack(changes: Partial<PackSummary> = {}): PackSummary {
  return PackSummarySchema.parse({
    packId: 'reference',
    name: 'Brinemoor (Reference Pack)',
    version: '0.1.0',
    description: 'A small fog-bound fishing town. Used by tests and for first play.',
    settingName: 'Brinemoor',
    scenarios: [
      {
        id: 'scenario.arrival',
        name: 'Arrival',
        description:
          'You arrive in Brinemoor on the evening coach, looking for your missing brother.',
        pcMode: 'either',
        premadePc: { id: 'pc.wren', name: 'Wren Ashby' },
      },
    ],
    toneProfiles: [
      {
        id: 'tone.coastal-mystery',
        name: 'Coastal Mystery',
        description: 'Slow-burn investigation in a closed community with secrets.',
      },
      { id: 'tone.adventure', name: 'Adventure', description: 'Bold deeds.' },
    ],
    rulesets: [
      { id: 'ruleset.standard', name: 'Standard', description: 'Fiction-first d6 pool.' },
      { id: 'ruleset.d20', name: 'd20', description: 'One die, twenty sides.' },
    ],
    defaults: { toneProfileId: 'tone.coastal-mystery', rulesetId: 'ruleset.standard' },
    issues: [],
    ...changes,
  });
}

/**
 * A second pack that can start a campaign, listed before the reference pack in tests. Its
 * first scenario needs a player-created PC, so the form never offers it in phase 1.
 */
export function saltmarshPack(changes: Partial<PackSummary> = {}): PackSummary {
  return PackSummarySchema.parse({
    packId: 'saltmarsh',
    name: 'Saltmarsh',
    version: '1.0.0',
    description: 'Smugglers on a marsh coast.',
    settingName: 'The Saltmarsh',
    scenarios: [
      {
        id: 'scenario.newcomer',
        name: 'Newcomer',
        description: 'Make your own smuggler.',
        pcMode: 'player-created',
        premadePc: null,
      },
      {
        id: 'scenario.low-tide',
        name: 'Low Tide',
        description: 'A cargo goes missing on the ebb.',
        pcMode: 'premade',
        premadePc: { id: 'pc.marn', name: 'Marn Tull' },
      },
    ],
    toneProfiles: [{ id: 'tone.adventure', name: 'Adventure', description: 'Bold deeds.' }],
    rulesets: [{ id: 'ruleset.d20', name: 'd20', description: 'One die, twenty sides.' }],
    defaults: { toneProfileId: 'tone.adventure', rulesetId: 'ruleset.d20' },
    issues: [],
    ...changes,
  });
}

/** A pack that failed to load, with two issues: one in a file, one about a whole file. */
export function brokenPack(): PackSummary {
  return PackSummarySchema.parse({
    packId: 'broken-coast',
    name: 'Broken Coast',
    version: '0.0.1',
    description: 'A pack with mistakes in it.',
    settingName: null,
    scenarios: [],
    toneProfiles: [],
    rulesets: [],
    defaults: { toneProfileId: null, rulesetId: 'ruleset.standard' },
    issues: [
      {
        file: 'entities/items/item.lantern.json',
        path: 'startingLocation.slot',
        message: '"belt" is not a slot in slots.everyday',
      },
      { file: 'setting.json', path: '', message: 'The file is not valid JSON.' },
    ],
  });
}
