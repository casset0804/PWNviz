import { create } from "zustand";

export type BottomTab = "environment" | "memory" | "diff" | "explanation" | "log";

interface SessionStore {
  selectedSampleId: string | null;
  setSelectedSampleId: (sampleId: string | null) => void;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
}

export const useSessionStore = create<SessionStore>()((set) => ({
  selectedSampleId: null,
  setSelectedSampleId: (selectedSampleId) => set({ selectedSampleId }),
  bottomTab: "environment",
  setBottomTab: (bottomTab) => set({ bottomTab }),
}));
