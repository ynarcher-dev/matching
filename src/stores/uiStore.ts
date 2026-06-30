import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 전역 UI 상태.
 * - sidebarOpen: 모바일 드로어 열림 여부(데스크톱은 상시 노출이라 무관, 비영속).
 * - sidebarCollapsed: 데스크톱 사이드바 접힘 여부(9-C, localStorage 유지).
 */
interface UiState {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      openSidebar: () => set({ sidebarOpen: true }),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      sidebarCollapsed: false,
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: 'yna-ui',
      // 데스크톱 접힘 설정만 유지(모바일 드로어 열림 상태는 매번 닫힌 채 시작).
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
