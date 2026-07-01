import { create } from 'zustand';

/** 토스트 종류(색·아이콘 위계). success=완료, error=실패, warning=주의, info=중립 안내. */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';

/** 클릭 액션 결과 알림에 붙일 수 있는 부가 옵션. */
export interface ToastOptions {
  /** 본문 아래 보조 설명(서버 에러 원문·복구 안내 등). */
  description?: string;
  /** 머무는 시간(ms). 미지정 시 tone별 기본값. */
  durationMs?: number;
  /** 액션 버튼 라벨(예: '다시 시도'). onAction 과 함께 사용. */
  actionLabel?: string;
  /** 액션 버튼 클릭 콜백. 실행 후 토스트는 닫힌다. */
  onAction?: () => void;
}

export interface Toast extends ToastOptions {
  id: number;
  tone: ToastTone;
  message: string;
}

/** tone별 기본 노출 시간(ms). 실패/주의는 조금 더 오래 둔다. */
const DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 6000,
};

interface ToastState {
  toasts: Toast[];
  /** 토스트를 추가하고 duration 후 자동으로 제거한다. */
  show: (message: string, tone?: ToastTone, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, tone = 'info', options = {}) => {
    const id = ++nextId;
    const { durationMs, ...rest } = options;
    const ttl = durationMs ?? DEFAULT_DURATION_MS[tone];
    set((s) => ({ toasts: [...s.toasts, { id, tone, message, ...rest }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 컴포넌트 밖(콜백 등)에서도 호출 가능한 단축 헬퍼. */
export const toast = {
  success: (message: string, options?: ToastOptions) =>
    useToastStore.getState().show(message, 'success', options),
  error: (message: string, options?: ToastOptions) =>
    useToastStore.getState().show(message, 'error', options),
  warning: (message: string, options?: ToastOptions) =>
    useToastStore.getState().show(message, 'warning', options),
  info: (message: string, options?: ToastOptions) =>
    useToastStore.getState().show(message, 'info', options),
};
