import { create } from 'zustand';

/**
 * 전역 UI 상태(모바일 사이드바 드로어 열림 여부 등).
 * 데스크톱(>=lg)에서는 사이드바가 상시 노출되므로 이 상태는 모바일 드로어 전용이다.
 */
interface UiState {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
