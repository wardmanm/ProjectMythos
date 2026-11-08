import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { machineConfig } from '@/test/settings-fixtures';
import { advancedGroups, defaultWords, valueAt, withValueAt } from './advanced-fields';
import { schemaDefaults } from './schema-defaults';
import {
  answerSave,
  choose,
  describedText,
  lastBody,
  region,
  renderSettings,
} from './settings-testing';

describe('AdvancedSection', () => {
  it("UI-088: every Advanced field shows the schema's default", async () => {
    await renderSettings();
    const advanced = within(region('Advanced'));
    const fields = advancedGroups.flatMap((group) => group.fields);
    expect(fields.map((field) => field.path[0])).toEqual(
      expect.arrayContaining(['context', 'world', 'memory', 'queue', 'retention']),
    );
    for (const field of fields) {
      const control = advanced.getByLabelText(field.label);
      const words = defaultWords(field, valueAt(schemaDefaults.config, field.path));
      expect(words, field.label).not.toBe('');
      expect(describedText(control), field.label).toContain(`Default: ${words}`);
    }
  });

  it('UI-088: every Advanced path names a field the schema has', () => {
    for (const field of advancedGroups.flatMap((group) => group.fields)) {
      expect(valueAt(schemaDefaults.config, field.path), field.path.join('.')).not.toBeUndefined();
    }
  });

  it('PRV-008, PRV-009: Advanced changes are saved with the rest of the config', async () => {
    const app = await renderSettings();
    const advanced = within(region('Advanced'));
    const voiced = advanced.getByLabelText('Most NPCs voiced in a turn');
    await app.user.clear(voiced);
    await app.user.type(voiced, '4');
    await choose(app.user, advanced.getByLabelText('NPC voices'), 'The narrator voices everyone');
    await app.user.click(advanced.getByLabelText('Simulate the world off-screen'));
    await app.user.clear(advanced.getByLabelText('Days to keep model call records'));
    await app.user.clear(advanced.getByLabelText('Retrieval weight: relevance'));
    await app.user.type(advanced.getByLabelText('Retrieval weight: relevance'), '2.5');
    answerSave(machineConfig());
    await app.user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    expect(lastBody('PUT', '/api/settings')).toMatchObject({
      context: { maxVoicedNpcsPerTurn: 4, npcVoice: 'shared' },
      world: { enabled: false },
      memory: { weights: { relevance: 2.5 } },
      retention: { modelCallRecordDays: null },
    });
  });

  it('PRV-003: a value set at a path leaves the rest of the config as it was', () => {
    const config = machineConfig();
    const changed = withValueAt(config, ['memory', 'consolidation', 'everyTurns'], 40);
    expect(changed.memory.consolidation.everyTurns).toBe(40);
    expect(config.memory.consolidation.everyTurns).toBe(25);
    expect(withValueAt(config, ['nowhere', 'at', 'all'], 1)).toEqual(config);
  });
});
