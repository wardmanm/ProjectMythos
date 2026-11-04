import { readdirSync, readFileSync } from 'node:fs';
import { ThemeSchema, ToneProfileSchema } from '@mythos/contracts/content';
import { contrast, themeIssues } from './theme';
import { eq, fixturePath } from '../test-support/harness';
eq('contrast: black on white is 21:1', contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
eq('contrast: WCAG example #777 on white is 4.48:1', contrast('#777777', '#FFFFFF').toFixed(2), '4.48');
const files = readdirSync(fixturePath('library/themes')).filter((f) => f.endsWith('.json'));
for (const f of files) {
  const t = ThemeSchema.parse(JSON.parse(readFileSync(fixturePath(`library/themes/${f}`), 'utf8')));
  eq(`${t.id}: passes every contrast rule and font check`, themeIssues(t), []);
}
const brine = ThemeSchema.parse(JSON.parse(readFileSync(fixturePath('library/themes/theme.brine.json'), 'utf8')));
const broken = ThemeSchema.parse({ ...brine, palettes: { dark: { ...brine.palettes.dark!, textMuted: '#4A5A62', playerText: brine.palettes.dark!.text } }, fonts: { ...brine.fonts, narration: { family: 'comic-neue' } } });
const issues = themeIssues(broken);
eq('a careless edit is caught: muted text (twice), identical player text, unknown font',
  [issues.length, issues.filter((i) => i.includes('textMuted on')).length, issues.some((i) => i.includes('playerText must differ')), issues.some((i) => i.includes('unknown font "comic-neue"'))],
  [4, 2, true, true]);
eq('a pack can ship its own font', themeIssues(ThemeSchema.parse({ ...brine, fonts: { ...brine.fonts, narration: { family: 'harbor-script' } } }), ['harbor-script']), []);
const tone = ToneProfileSchema.parse({ ...JSON.parse(readFileSync(fixturePath('packs/reference/tone-profiles/tone.coastal-mystery.json'), 'utf8')), themeId: 'theme.brine' });
eq('tone profile references a theme', tone.themeId, 'theme.brine');
