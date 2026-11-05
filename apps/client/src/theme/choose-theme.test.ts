import { ThemeSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { chooseTheme } from './choose-theme';
import { houseTheme } from './house-theme';

const deviceTheme = ThemeSchema.parse({ ...houseTheme, id: 'theme.high-contrast' });
const campaignTheme = ThemeSchema.parse({ ...houseTheme, id: 'theme.brine' });

describe('chooseTheme', () => {
  it('UI-030: the device theme beats the campaign theme, which beats the house theme', () => {
    const house = houseTheme;
    expect(chooseTheme({ device: deviceTheme, campaign: campaignTheme, house }).id).toBe(
      'theme.high-contrast',
    );
    expect(chooseTheme({ device: null, campaign: campaignTheme, house }).id).toBe('theme.brine');
    expect(chooseTheme({ device: null, campaign: null, house }).id).toBe('theme.house');
  });

  it('UI-030: outside a campaign, the house theme applies unless the device forces another', () => {
    expect(chooseTheme({ device: deviceTheme, campaign: null, house: houseTheme }).id).toBe(
      'theme.high-contrast',
    );
  });
});
