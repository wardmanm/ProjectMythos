// The public API of @mythos/core: pure game logic, deterministic given its inputs
// (ARCH-010).
export { cmp } from './compare';
export {
  type ResolvedDate,
  calendarIssues,
  dateIssues,
  dayMinutes,
  fromDate,
  isLeap,
  minutesUntil,
  monthDays,
  timeOfDay,
  toDate,
} from './time/calendar';
export { formatDate, formatDuration } from './time/calendar-display';
export { CONTRAST_RULES, contrast, themeIssues } from './theme';
export {
  type ContentCategory,
  appendFloorToTask,
  appendLocked,
  CATEGORY_LABELS,
  CONTENT_CATEGORIES,
  DEFAULT_WORDING,
  effectiveSettings,
  FLOOR_ROLES,
  HARD_FLOOR,
  minorInvolved,
  renderContentSettings,
  usesExplicitRoles,
} from './prompts/content';
export { rulesetIssues, rulingLimitsFor } from './rules/ruleset-check';
export { containerUse, loadOf, possessor, validateItemMove } from './rules/gear';
export { type Appearance, appearanceOf } from './rules/gear-appearance';
export { commonKnowledge, displayName } from './knowledge/journal';
export {
  type BudgetOverflow,
  type TierBudgets,
  type TierSpec,
  allocateBudgets,
  estimateTokens,
  inputBudget,
  transcriptBoundary,
} from './prompts/context';
export {
  activeSets,
  entriesInOrder,
  orderSets,
  type SetWithDepth,
  staleStages,
} from './state/turn-logic';
export {
  type FoldContext,
  type FoldedState,
  initialState,
  relationshipKey,
} from './state/folded-state';
export { applyCommit } from './state/apply-commit';
export { commitIssues } from './state/validate';
export { type CommitSetEntry, fold, validateSet } from './state/fold';
export { buildSetup, type Setup, type SetupChoices, type SetupPack } from './state/setup';
