// Implements UI-100: server state lives in TanStack Query under these keys. Every key
// for a campaign's data has the campaign ID second, so one prefix match finds them all
// (resync.required, UI-101). GM-mode keys, which add 'gm', arrive with GM mode in phase 5.

export const queryKeys = {
  /** `CampaignSummary[]`, for the library. */
  campaigns: () => ['campaigns'] as const,
  /** `CampaignView`. */
  campaign: (campaignId: string) => ['campaign', campaignId] as const,
  /** `TurnView[]`, oldest first: the turns on a branch. */
  turns: (campaignId: string, branchId: string) => ['turns', campaignId, branchId] as const,
  /** `TurnView`: one turn. */
  turn: (campaignId: string, turnId: string) => ['turn', campaignId, turnId] as const,
  /** The scene panel's data for a branch (phase 3). */
  scene: (campaignId: string, branchId: string) => ['scene', campaignId, branchId] as const,
  /** An entity's sheet (phase 3). */
  sheet: (campaignId: string, entityId: string) => ['sheet', campaignId, entityId] as const,
  /** The journal (phase 5); later parts of the key name the page or entity. */
  journal: (campaignId: string, ...rest: string[]) => ['journal', campaignId, ...rest] as const,
  /** `MachineConfig`, with its secrets redacted (CON-111). */
  settings: () => ['settings'] as const,
};

/** The key prefixes that match every query of one kind for a campaign. */
export const campaignPrefixes = {
  turns: (campaignId: string) => ['turns', campaignId] as const,
  scene: (campaignId: string) => ['scene', campaignId] as const,
  journal: (campaignId: string) => ['journal', campaignId] as const,
};

/** Whether a query key belongs to the campaign: its second element is the campaign ID. */
export function isCampaignKey(queryKey: readonly unknown[], campaignId: string): boolean {
  return queryKey[1] === campaignId;
}
