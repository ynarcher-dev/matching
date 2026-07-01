import type { ReactNode } from 'react';
import { useToastStore } from '@/stores/toastStore';
import type { Toast, ToastTone } from '@/stores/toastStore';

/**
 * 전역 토스트 뷰포트 (하단 중앙 고정).
 * App 루트에 1회 마운트하고, 어디서든 toast.success/error/info 로 알림을 띄운다.
 */
const TONE: Record<ToastTone, { box: string; icon: ReactNode }> = {
  success: {
    box: 'border-success-border bg-success-surface text-success',
    icon: <CheckIcon />,
  },
  error: {
    box: 'border-danger-border bg-danger-surface text-danger',
    icon: <ExclamationIcon />,
  },
  warning: {
    box: 'border-warning-border bg-warning-surface text-warning',
    icon: <ExclamationIcon />,
  },
  info: {
    box: 'border-border bg-neutral-base text-white',
    icon: <InfoIcon />,
  },
};

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4"
      role="region"
      aria-label="알림"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { box, icon } = TONE[toast.tone];
  const { message, description, actionLabel, onAction } = toast;
  return (
    <div
      role="status"
      onClick={onDismiss}
      className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg animate-toast-in ${box}`}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{message}</span>
        {description != null && (
          <span className="text-xs font-medium opacity-80">{description}</span>
        )}
      </div>
      {actionLabel != null && onAction != null && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
            onDismiss();
          }}
          className="ml-1 shrink-0 self-center rounded border border-current px-2 py-1 text-xs font-semibold"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8.2 7 10l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExclamationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.5v4M8 5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
