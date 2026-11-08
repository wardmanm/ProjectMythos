import {
  MachineConfigSchema,
  ProbeResultSchema,
  ProviderStatusSchema,
  SaveSettingsResultSchema,
  type MachineConfig,
  type SetPinCommandSchema,
} from '@mythos/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request, requestNoContent } from './client';
import { queryKeys } from './query-keys';

/**
 * The machine config: `GET /settings` (03-contracts §14). Every inline API key and the
 * PIN hash arrive as `SECRET_PLACEHOLDER` (CON-111); a save that sends a placeholder back
 * unchanged keeps the stored secret.
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => request('/settings', MachineConfigSchema, { signal }),
  });
}

/**
 * Saves the whole machine config with `PUT /settings` (PRV-003). The answer is the config
 * as saved, secrets replaced, and whether a restart is needed (PRV-004). On success every
 * `['settings']` query refetches: the config, the provider statuses, and the model lists.
 * The mutation does not wait for them, so the caller hears of the save first.
 */
export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: MachineConfig) =>
      request('/settings', SaveSettingsResultSchema, { method: 'PUT', body: config }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}

export type SetPinCommand = z.input<typeof SetPinCommandSchema>;

/**
 * Sets, changes, or removes the PIN with `PUT /settings/pin`. It applies at once and ends
 * every session (01-architecture Decisions), so the settings refetch afterwards, and a
 * device that is not exempt goes to the PIN screen.
 */
export function useSetPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: SetPinCommand) =>
      requestNoContent('/settings/pin', { method: 'PUT', body: command }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}

/** Each provider's health, in config order: `GET /settings/providers` (PRV-091). */
export function useProviderStatuses() {
  return useQuery({
    queryKey: queryKeys.providerStatuses(),
    queryFn: ({ signal }) =>
      request('/settings/providers', z.array(ProviderStatusSchema), { signal }),
  });
}

/**
 * The models a saved provider lists, for the model pickers (PRV-091). `enabled` is false
 * while the provider is new or changed, since the server reads the saved config.
 */
export function useProviderModels(providerId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.providerModels(providerId),
    queryFn: ({ signal }) =>
      request(`/settings/providers/${encodeURIComponent(providerId)}/models`, z.array(z.string()), {
        signal,
      }),
    enabled,
  });
}

export type ProbeRequest = { profileId: string; signal: AbortSignal };

/**
 * Probes a saved model profile with `POST /settings/profiles/:profileId/probe` (PRV-090).
 * The caller passes a signal, so Cancel aborts the request and the server stops probing.
 */
export function useProbe() {
  return useMutation({
    mutationFn: ({ profileId, signal }: ProbeRequest) =>
      request(`/settings/profiles/${encodeURIComponent(profileId)}/probe`, ProbeResultSchema, {
        method: 'POST',
        signal,
      }),
  });
}
