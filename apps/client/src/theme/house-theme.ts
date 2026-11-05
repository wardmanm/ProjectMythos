import { ThemeSchema, type Theme } from '@mythos/contracts/content';
import houseThemeFile from '../../../../content-library/themes/theme.house.json';

/**
 * The app's own theme (14-ui §3.3), read from the built-in library at build time and
 * parsed like any other theme. Phase 1 uses it everywhere (14-ui §15).
 */
export const houseTheme: Theme = ThemeSchema.parse(houseThemeFile);
