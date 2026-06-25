import type { ReactNode } from 'react';

type AlertTone = 'error' | 'info' | 'success';

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}

/**
 * 상태 안내 박스 (page_auth_layout.md §2.1).
 * 굵은 사각 테두리 대신 연한 상태 배경 + 왼쪽 강조선 + 아이콘으로 위계를 만든다.
 */
const TONE: Record<AlertTone, { box: string; icon: ReactNode }> = {
  error: {
    box: 'border-l-brand bg-danger-surface text-brand',
    icon: <ExclamationIcon />,
  },
  info: {
    box: 'border-l-neutral-base bg-info-surface text-neutral-base',
    icon: <InfoIcon />,
  },
  success: {
    box: 'border-l-neutral-base bg-muted text-neutral-base',
    icon: <CheckIcon />,
  },
};

export function Alert({ tone = 'info', children, className = '' }: AlertProps) {
  const { box, icon } = TONE[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border-l-4 px-3 py-2 text-sm font-medium ${box} ${className}`}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </div>
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

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8.2 7 10l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
