// Inline secrets (API keys) and the PIN hash stay on this machine (PRV-005). Responses
// carry SECRET_PLACEHOLDER in their place, and a save that sends the placeholder back
// keeps the stored value (CON-111). Never log a config object (CONV-072).
import {
  type AppError,
  type MachineConfig,
  type Result,
  SECRET_PLACEHOLDER,
  type SecretSchema,
  type SemanticIssue,
  err,
  ok,
} from '@mythos/contracts';
import type { z } from 'zod';
import type { DataDirEnv } from './data-dir';

type Secret = z.infer<typeof SecretSchema>;

/**
 * The secret's value: from the named environment variable, or as stored inline.
 * A missing variable is `not_configured`. Implements PRV-005.
 */
export function resolveSecret(secret: Secret, env: DataDirEnv): Result<string, AppError> {
  if ('value' in secret) return ok(secret.value);
  const value = env[secret.env];
  if (value === undefined || value === '') {
    return err({
      code: 'not_configured',
      message: `The environment variable ${secret.env} is not set. Set it, or enter the key in Settings.`,
    });
  }
  return ok(value);
}

/**
 * A copy of the config that is safe to send: every inline API key and the PIN hash are
 * replaced by SECRET_PLACEHOLDER. An `{ env }` secret stays, since it only names a
 * variable. Implements CON-111.
 */
export function redact(config: MachineConfig): MachineConfig {
  const copy = structuredClone(config);
  for (const provider of copy.providers) {
    if ('apiKey' in provider && provider.apiKey !== undefined && 'value' in provider.apiKey) {
      provider.apiKey = { value: SECRET_PLACEHOLDER };
    }
  }
  if (copy.server.pin !== null) copy.server.pin.hash = SECRET_PLACEHOLDER;
  return copy;
}

/**
 * Puts stored secrets back where a save sent the placeholder, before the save is
 * validated. A provider's key comes from the stored provider with the same id, so
 * reordering or deleting providers never moves a key. A placeholder with nothing stored
 * is an issue at its path. The input is not changed. Implements CON-111.
 */
export function mergeSecrets(
  incoming: unknown,
  stored: MachineConfig | null,
): { config: unknown; issues: SemanticIssue[] } {
  const config = structuredClone(incoming);
  if (!isRecord(config)) return { config, issues: [] };
  const issues = [...mergeProviderKeys(config, stored), ...mergePinHash(config, stored)];
  return { config, issues };
}

function mergeProviderKeys(
  config: Record<string, unknown>,
  stored: MachineConfig | null,
): SemanticIssue[] {
  const providers = config.providers;
  if (!isArray(providers)) return [];
  const issues: SemanticIssue[] = [];
  providers.forEach((provider, index) => {
    if (!isRecord(provider) || !isRecord(provider.apiKey)) return;
    if (provider.apiKey.value !== SECRET_PLACEHOLDER) return;
    const id = provider.id;
    const key = typeof id === 'string' ? storedInlineKey(stored, id) : undefined;
    if (key === undefined) {
      issues.push({
        path: `providers.${String(index)}.apiKey.value`,
        message: `No key is stored for provider "${String(id)}". Enter the key again.`,
      });
    } else {
      provider.apiKey.value = key;
    }
  });
  return issues;
}

function storedInlineKey(stored: MachineConfig | null, providerId: string): string | undefined {
  const provider = stored?.providers.find((candidate) => candidate.id === providerId);
  if (provider === undefined || !('apiKey' in provider) || provider.apiKey === undefined) {
    return undefined;
  }
  return 'value' in provider.apiKey ? provider.apiKey.value : undefined;
}

function mergePinHash(
  config: Record<string, unknown>,
  stored: MachineConfig | null,
): SemanticIssue[] {
  const server = config.server;
  if (!isRecord(server) || !isRecord(server.pin)) return [];
  if (server.pin.hash !== SECRET_PLACEHOLDER) return [];
  const hash = stored?.server.pin?.hash;
  if (hash === undefined) {
    return [{ path: 'server.pin.hash', message: 'No PIN is stored. Set the PIN again.' }];
  }
  server.pin.hash = hash;
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
