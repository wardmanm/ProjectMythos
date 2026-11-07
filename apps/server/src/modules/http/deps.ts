// What the composition root gives the http module (ARCH-022). Every member is another
// module's public API, or a function the root builds from them; routes call these and
// nothing else (ARCH-023).
import type { AppError, Result } from '@mythos/contracts';
import type { Auth } from '../auth';
import type { ConfigStore } from '../config';
import type { Content } from '../content';
import type { EventBus } from '../events';
import type { HealthCheck, ProviderProbe, SetTimer } from '../providers';
import type { TurnDeps } from '../turn';

export type HttpDeps = {
  /** Machine config, read for `GET /settings` and saved by `PUT /settings`. */
  config: Pick<ConfigStore, 'current' | 'save'>;
  /** The PIN lock: the gate, the session routes, and `PUT /settings/pin`. */
  auth: Auth;
  /** Packs, themes, and the pack a new campaign is made from. */
  content: Content;
  /** The event bus, which the event stream subscribes to. */
  bus: Pick<EventBus, 'subscribe' | 'lastId'>;
  /** What the turn module's commands and views take, the campaign store among them. */
  turn: TurnDeps;
  probe: ProviderProbe;
  health: HealthCheck;
  /** A provider's models, or `not_found` for a provider not in machine config (PRV-091). */
  listModels: (providerId: string, signal: AbortSignal) => Promise<Result<string[], AppError>>;
  /** The built client's folder, or null to serve the API alone (ARCH-102). */
  clientDir: string | null;
  /** Starts a timer and returns its cancel, for the event stream's keep-alive (CON-114). */
  setTimer: SetTimer;
};
