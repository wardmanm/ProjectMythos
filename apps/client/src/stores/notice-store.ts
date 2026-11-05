import { create } from 'zustand';

/**
 * A message the shell shows until the player dismisses it or another replaces it. UI
 * state only, never server data (ARCH-121): the text is written for the player.
 */
export type Notice = { tone: 'info' | 'failure'; text: string };

type NoticeState = {
  notice: Notice | null;
  show: (notice: Notice) => void;
  dismiss: () => void;
};

export const useNoticeStore = create<NoticeState>()((set) => ({
  notice: null,
  show: (notice) => {
    set({ notice });
  },
  dismiss: () => {
    set({ notice: null });
  },
}));
