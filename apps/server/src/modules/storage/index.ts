// The storage module's public API (ARCH-020): campaign folders and databases, and the
// repositories for everything stored in them. It imports no other module (ARCH-021).
export { type CampaignStore, type CampaignStoreOptions, createCampaignStore } from './campaigns';
export { type CampaignStart, writeCampaignStart } from './campaign-start';
export {
  type CanonEntry,
  type CanonKind,
  type CanonTemplate,
  type CanonValue,
  listCanon,
  readCanon,
  readTemplates,
  type SnapshotTemplateLayer,
  writeCanon,
} from './canon';
export { createBranch, listBranches, readBranch } from './branches';
export {
  readState,
  readStateHistory,
  type StateKey,
  type StateValue,
  type StateVersion,
  writeState,
} from './campaign-state';
export { insertJob, listUnfinishedJobs, updateJob } from './jobs';
export { insertModelCall, listModelCalls, pruneModelCalls, readModelCall } from './model-calls';
export { readSetsForRead, type SetForRead } from './read-sets';
export { rebuildProjections } from './rebuild';
export { type CampaignRecord, CampaignRecordSchema, type PersistedJob } from './rows';
export { type Database, openDatabase } from './sqlite';
export {
  appendSet,
  insertRootTurn,
  insertTurn,
  type NewCommit,
  type NewCommitSet,
  readTurn,
  readTurnsOnBranch,
  setTurnStatus,
} from './turns';
