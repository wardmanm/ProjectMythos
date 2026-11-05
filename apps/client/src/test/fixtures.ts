// Valid server data for tests, parsed with the contract schemas so it cannot drift from them.
import {
  CampaignViewSchema,
  TurnViewSchema,
  type CampaignView,
  type ServerEvent,
  type ServerEventPayload,
  type TurnView,
} from '@mythos/contracts';
import { houseTheme } from '@/theme/house-theme';

export const campaignId = '6f1c0b9e-3a52-4d7e-9a61-2b8f4c1d0e01';
export const branchId = '6f1c0b9e-3a52-4d7e-9a61-2b8f4c1d0e02';
export const turnId = '6f1c0b9e-3a52-4d7e-9a61-2b8f4c1d0e03';
export const otherCampaignId = '6f1c0b9e-3a52-4d7e-9a61-2b8f4c1d0e04';

/** The campaign view `GET /campaigns/:campaignId` answers with. */
export function campaignView(changes: Partial<CampaignView> = {}): CampaignView {
  return CampaignViewSchema.parse({
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
    packId: 'reference',
    rulesetId: 'ruleset.standard',
    pcId: 'pc.wren',
    currentBranchId: branchId,
    headTurnId: turnId,
    theme: houseTheme,
    ...changes,
  });
}

/** A turn as `GET /turns/:turnId` answers with it, narrating, with `text` streamed so far. */
export function turnView(text: string | null, changes: { id?: string } = {}): TurnView {
  return TurnViewSchema.parse({
    turn: {
      id: changes.id ?? turnId,
      parentTurnId: null,
      depth: 0,
      status: 'narrating',
      gameTimeStart: 0,
      copiedFromTurnId: null,
      createdAt: '2026-11-05T10:00:00Z',
    },
    gameTimeLabel: 'Monday, October 12, 1874, evening',
    input: null,
    ruling: null,
    visibleExplanation: null,
    draft: null,
    resolution: null,
    narration: text === null ? null : { text, complete: false },
    staleStages: [],
    failedStages: [],
    replayConflictCount: 0,
    offscreen: null,
    versionCounts: {},
    sharedWithOtherBranches: false,
    bookmarkNames: [],
  });
}

let nextEventId = 1000;

/** A server event for the test campaign, with the next ID. */
export function serverEvent(payload: ServerEventPayload, id = nextEventId++): ServerEvent {
  return { id, campaignId, payload };
}
