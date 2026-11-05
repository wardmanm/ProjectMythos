import type { ErrorCode } from '@mythos/contracts';
import type { ApiFailure } from './api-failure';

/*
 * Implements UI-122: each failure says what happened, then what to do. No apology, and
 * never the code itself; the inspector is the only place codes appear.
 */

const wordsByCode = {
  validation_failed: "Some of what you entered isn't valid. Check each field and try again.",
  not_found: "That isn't here anymore. Go back to the library and choose again.",
  conflict: 'This campaign changed on another device. Showing the latest.',
  turn_in_progress: 'A turn is still running. Wait for it to finish, or stop it first.',
  illegal_state_change: "That change breaks one of the campaign's rules. Change it and try again.",
  model_output_invalid:
    "The model's answer couldn't be used, even after retrying. Try again, or choose another model in Settings.",
  provider_unavailable:
    "The model isn't responding. Check that its server is running, or choose another model in Settings.",
  provider_timeout:
    'The model took too long to answer. Try again, or choose a faster model in Settings.',
  provider_rejected:
    'The model refused the request. Try again, or choose another model in Settings.',
  context_overflow:
    "The campaign no longer fits in this model's context. Choose a model with a larger context in Settings.",
  not_configured: 'No model is assigned to this job. Assign one in Settings.',
  cancelled: 'That stopped before it finished. Try again when you are ready.',
  auth_required: 'This device needs the PIN. Enter it to carry on.',
  auth_failed: "That PIN isn't right. Check it and try again.",
  rate_limited: 'Too many tries in a row. Wait a minute, then try again.',
  internal_error:
    'Something went wrong on the server. Try again, and if it keeps happening, restart Mythos.',
} as const satisfies Record<ErrorCode, string>;

/** The plain words for a server error code. */
export function wordsForCode(code: ErrorCode): string {
  return wordsByCode[code];
}

/** The plain words for any failed request. */
export function plainWords(failure: ApiFailure): string {
  switch (failure.kind) {
    case 'server':
      return wordsForCode(failure.error.code);
    case 'unreachable':
      return "Mythos can't reach its server. Check that it is running and that this device is on the same network.";
    case 'invalid-response':
      return "The server's answer didn't match what this page expects. Reload the page and try again.";
  }
}
