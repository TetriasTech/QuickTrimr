import { create } from 'zustand';

import type { BookingType } from '@quicktrimr/shared';

export type BookingDraftValues = {
  radiusKm: number | null;
  scheduledFor: string | null;
  selectedAddressId: string | null;
  selectedBarberId: string | null;
  selectedBookingType: BookingType | null;
  selectedServiceCategoryId: string | null;
};

type BookingDraftActions = {
  replaceDraft: (
    draft: Omit<BookingDraftValues, 'radiusKm' | 'scheduledFor'> &
      Partial<Pick<BookingDraftValues, 'radiusKm' | 'scheduledFor'>>,
  ) => void;
  patchDraft: (draft: Partial<BookingDraftValues>) => void;
  resetDraft: () => void;
};

export type BookingDraftState = BookingDraftValues & BookingDraftActions;

const emptyBookingDraft: BookingDraftValues = {
  radiusKm: null,
  scheduledFor: null,
  selectedAddressId: null,
  selectedBarberId: null,
  selectedBookingType: null,
  selectedServiceCategoryId: null,
};

export const useBookingDraftStore = create<BookingDraftState>((set) => ({
  ...emptyBookingDraft,
  replaceDraft: (draft) => set({ ...emptyBookingDraft, ...draft }),
  patchDraft: (draft) => set(draft),
  resetDraft: () => set(emptyBookingDraft),
}));
