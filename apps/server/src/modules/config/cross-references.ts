// The checks machine config needs after it matches its schema (PRV-002): every ID it
// refers to must exist, be unique, and be the right kind of thing. Every issue is
// reported at once, at a dotted path (CON-091), as content packs are (SCH-100).
import type { MachineConfig, SemanticIssue } from '@mythos/contracts';

type RoleAssignment = { profileId: string };

/**
 * Every cross-reference problem in a config that already passed its schema. Empty means
 * the config is usable. Implements PRV-002.
 */
export function checkCrossReferences(config: MachineConfig): SemanticIssue[] {
  return [
    ...duplicateIds(config),
    ...deviceReferences(config),
    ...providerReferences(config),
    ...roleReferences(config),
    ...embeddingDimensions(config),
    ...mediaReferences(config),
  ];
}

// An ID used twice would make "resolves" ambiguous.
function duplicateIds(config: MachineConfig): SemanticIssue[] {
  const lists = [
    ['devices', config.devices],
    ['providers', config.providers],
    ['modelProfiles', config.modelProfiles],
    ['mediaProfiles', config.mediaProfiles],
  ] as const;
  const issues: SemanticIssue[] = [];
  for (const [name, items] of lists) {
    const firstIndex = new Map<string, number>();
    items.forEach((item, index) => {
      const first = firstIndex.get(item.id);
      if (first === undefined) {
        firstIndex.set(item.id, index);
      } else {
        issues.push({
          path: `${name}.${String(index)}.id`,
          message: `"${item.id}" is already the id of ${name}.${String(first)}`,
        });
      }
    });
  }
  return issues;
}

function deviceReferences(config: MachineConfig): SemanticIssue[] {
  const deviceIds = new Set(config.devices.map((device) => device.id));
  return config.providers.flatMap((provider, index) =>
    deviceIds.has(provider.deviceId)
      ? []
      : [
          {
            path: `providers.${String(index)}.deviceId`,
            message: `"${provider.deviceId}" is not the id of a device in devices`,
          },
        ],
  );
}

function providerReferences(config: MachineConfig): SemanticIssue[] {
  const providerIds = new Set(config.providers.map((provider) => provider.id));
  const check = (list: string, profiles: readonly { providerId: string }[]): SemanticIssue[] =>
    profiles.flatMap((profile, index) =>
      providerIds.has(profile.providerId)
        ? []
        : [
            {
              path: `${list}.${String(index)}.providerId`,
              message: `"${profile.providerId}" is not the id of a provider in providers`,
            },
          ],
    );
  return [
    ...check('modelProfiles', config.modelProfiles),
    ...check('mediaProfiles', config.mediaProfiles),
  ];
}

// The embedder needs an embedding profile; every other role generates text.
function roleReferences(config: MachineConfig): SemanticIssue[] {
  const profiles = new Map(config.modelProfiles.map((profile) => [profile.id, profile]));
  const check = (section: string, role: string, assignment: RoleAssignment): SemanticIssue[] => {
    const path = `${section}.${role}.profileId`;
    const profile = profiles.get(assignment.profileId);
    if (profile === undefined) {
      return [
        { path, message: `"${assignment.profileId}" is not the id of a profile in modelProfiles` },
      ];
    }
    const kind = role === 'embedder' ? 'embedding' : 'text';
    if (profile.kind !== kind) {
      return [
        {
          path,
          message: `the ${role} role needs ${withArticle(kind)} profile, not ${profile.kind}`,
        },
      ];
    }
    return [];
  };
  const assigned = (section: string, roles: Record<string, RoleAssignment | null | undefined>) =>
    Object.entries(roles).flatMap(([role, assignment]) =>
      assignment === null || assignment === undefined ? [] : check(section, role, assignment),
    );
  return [
    ...assigned('roles', config.roles),
    ...assigned('explicitContentRoles', config.explicitContentRoles),
  ];
}

function embeddingDimensions(config: MachineConfig): SemanticIssue[] {
  return config.modelProfiles.flatMap((profile, index) =>
    profile.kind === 'embedding' && profile.embeddingDimensions === undefined
      ? [
          {
            path: `modelProfiles.${String(index)}.embeddingDimensions`,
            message: 'an embedding profile needs embeddingDimensions',
          },
        ]
      : [],
  );
}

// The media section picks one media profile per feature, of that feature's kind (MED-002).
function mediaReferences(config: MachineConfig): SemanticIssue[] {
  const profiles = new Map(config.mediaProfiles.map((profile) => [profile.id, profile]));
  const { media } = config;
  const picks = [
    ['media.imageProfileId', 'image', media.imageProfileId],
    ['media.speechOutputProfileId', 'speech-output', media.speechOutputProfileId],
    ['media.speechInput.profileId', 'speech-input', media.speechInput.profileId],
  ] as const;
  const issues: SemanticIssue[] = [];
  for (const [path, kind, profileId] of picks) {
    if (profileId === null) continue;
    const profile = profiles.get(profileId);
    if (profile === undefined) {
      issues.push({ path, message: `"${profileId}" is not the id of a profile in mediaProfiles` });
    } else if (profile.kind !== kind) {
      issues.push({ path, message: `needs ${withArticle(kind)} profile, not ${profile.kind}` });
    }
  }
  if (media.speechInput.mode === 'server' && media.speechInput.profileId === null) {
    issues.push({
      path: 'media.speechInput.profileId',
      message: 'speech input in server mode needs a speech-input profile',
    });
  }
  return issues;
}

function withArticle(kind: string): string {
  return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}
