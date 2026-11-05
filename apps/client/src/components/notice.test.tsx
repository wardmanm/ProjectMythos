import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError } from '@/api/api-failure';
import { useNoticeStore } from '@/stores/notice-store';
import { FailureMessage } from './failure-message';
import { Notice } from './notice';

describe('Notice', () => {
  it('UI-114, UI-122: a failure notice is shown in words, with color as an extra', () => {
    render(<Notice />);
    act(() => {
      useNoticeStore
        .getState()
        .show({ tone: 'failure', text: 'The model took too long to answer.' });
    });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('The model took too long to answer.');
    const box = status.querySelector('[data-tone=failure]');
    expect(box?.className).toContain('border-l-negative');
  });

  it('UI-110: a notice is dismissed with its button', async () => {
    const user = userEvent.setup();
    render(<Notice />);
    act(() => {
      useNoticeStore.getState().show({ tone: 'info', text: 'Showing the latest.' });
    });
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('FailureMessage', () => {
  it('UI-114, UI-122: a failed request is shown in plain words, never its code', () => {
    const error = apiError({
      kind: 'server',
      status: 504,
      error: { code: 'provider_timeout', message: 'timed out after 120 s' },
    });
    render(<FailureMessage error={error} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(
      'The model took too long to answer. Try again, or choose a faster model in Settings.',
    );
    expect(alert.textContent).not.toContain('provider_timeout');
    expect(alert.className).toContain('border-l-negative');
  });

  it('UI-122: anything else thrown still gets plain words', () => {
    render(<FailureMessage error={new Error('undefined is not a function')} />);
    expect(screen.getByRole('alert').textContent).not.toContain('undefined');
  });
});
