import { create } from 'zustand';

import type { BookingType } from '@quicktrimr/shared';

type BookingDraftValues = {
  selectedAddressId: string | null;
  selectedBarberId: string | null;
  selectedBookingType: BookingType | null;
  selectedServiceCategoryId: string | null;
};

type BookingDraftActions = {
  replaceDraft: (draft: BookingDraftValues) => void;
  resetDraft: () => void;
};

export type BookingDraftState = BookingDraftValues & BookingDraftActions;

const emptyBookingDraft: BookingDraftValues = {
  selectedAddressId: null,
  selectedBarberId: null,
  selectedBookingType: null,
  selectedServiceCategoryId: null,
};

export const useBookingDraftStore = create<BookingDraftState>((set) => ({
  ...emptyBookingDraft,
  replaceDraft: (draft) => set(draft),
  resetDraft: () => set(emptyBookingDraft),
}));
