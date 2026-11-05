import type { Theme } from '@mythos/contracts/content';

/**
 * The themes that could apply to a screen. `campaign` is the campaign view's resolved
 * theme, which already weighs the campaign's override against its tone profile's
 * `themeId` on the server (03-contracts §14.1). Each is null when it does not apply.
 */
export type ThemeCandidates = {
  /** The device's reader preference, when it forces a theme (14-ui §12.2). */
  device: Theme | null;
  /** The open campaign's theme; null outside a campaign. */
  campaign: Theme | null;
  house: Theme;
};

/** The theme a screen shows. Implements UI-030: device, then campaign, then house. */
export function chooseTheme(candidates: ThemeCandidates): Theme {
  return candidates.device ?? candidates.campaign ?? candidates.house;
}
