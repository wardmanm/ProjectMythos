// Which model profile, provider, and sampling a role's call uses, from machine config's
// `roles` (PRV-001). Pure, so the composition root can give the same routing to the
// context module, which imports neither config nor providers (CTX-110).
import {
  type AppError,
  err,
  type MachineConfig,
  type ModelProfile,
  type ModelRole,
  ok,
  type ProviderConfig,
  type Result,
} from '@mythos/contracts';

/** Where one role's calls go. */
export type RoleRoute = {
  profile: ModelProfile;
  provider: ProviderConfig;
  /** The profile's sampling, with the role's own settings over it, key by key. */
  sampling: ModelProfile['sampling'];
};

/**
 * Roles that use another role's assignment while their own is null: NPC voice uses the
 * narrator's (PRV-009), and the speech segmenter the extractor's (PRV-015). The
 * illustrator's fallback is templates, not a model, so it is not here.
 */
const FALLBACK_ROLE: Partial<Record<ModelRole, ModelRole>> = {
  'npc-voice': 'narrator',
  'speech-segmenter': 'extractor',
};

/**
 * The route for a role's call. An unassigned role, with no assigned fallback, is
 * `not_configured`, and the message names the role and points to Settings. Profile and
 * provider IDs always resolve in a loaded config (PRV-002), so one that does not throws.
 * The campaign's explicit-content routing (PRV-006) arrives in phase 3. Implements
 * PRV-001, PRV-009, and PRV-015.
 */
export function routeRole(config: MachineConfig, role: ModelRole): Result<RoleRoute, AppError> {
  const fallback = FALLBACK_ROLE[role];
  const assignment = config.roles[role] ?? (fallback === undefined ? null : config.roles[fallback]);
  if (assignment === null) {
    const also = fallback === undefined ? '' : ` or to the ${fallback} role it falls back to`;
    const message = `No model is assigned to the ${role} role${also}. Choose one in Settings.`;
    return err({ code: 'not_configured', message });
  }
  const profile = config.modelProfiles.find((each) => each.id === assignment.profileId);
  if (profile === undefined) {
    throw new Error(`The ${role} role names profile "${assignment.profileId}", which is missing.`);
  }
  const provider = config.providers.find((each) => each.id === profile.providerId);
  if (provider === undefined) {
    throw new Error(
      `Profile "${profile.id}" names provider "${profile.providerId}", which is missing.`,
    );
  }
  return ok({ profile, provider, sampling: { ...profile.sampling, ...assignment.sampling } });
}
