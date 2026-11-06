// The turn module's public API (ARCH-020): creating campaigns, playing linear turns
// (submit, stream, Stop, retry), and reading their views. It imports context, providers,
// content, storage, and events only through their public APIs (ARCH-021).
export { campaignView, listCampaignSummaries } from './campaign-view';
export { type CreateCampaignDeps, createCampaign } from './create-campaign';
export type {
  CancelCommand,
  NarrationStart,
  Narrations,
  Publish,
  RegenerateStageCommand,
  SubmitActionCommand,
  TurnDeps,
  TurnLogger,
} from './deps';
export { createNarrations, type NarrationDeps } from './narration';
export { submitAction } from './submit-action';
export { cancelTurn } from './cancel-turn';
export { recoverInterruptedTurns, regenerateStage } from './retry-narration';
export { type BranchView, branchViews, turnView, turnViews, type ViewDeps } from './turn-view';
