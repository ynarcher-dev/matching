import type { ReactNode } from 'react';

type StatusBannerTone = 'info' | 'warning' | 'danger' | 'neutral';

interface StatusBannerProps {
  /** 배너 위계. info=중립 안내, warning=주의/비용, danger=위험, neutral=옅은 맥락. */
  tone?: StatusBannerTone;
  /** 핵심 상태 한 줄(굵게). */
  label: ReactNode;
  /** 보조 설명(선택). */
  detail?: ReactNode;
  /** 우측 액션(예: 모드 전환 버튼). */
  action?: ReactNode;
  className?: string;
}

/**
 * 페이지/패널 상단에 계속 남는 지속 상태 배너 (ui_feedback_message_audit §7.3).
 * "현재 발송 모드", "전역 발송 비활성", "진행 단계 아님" 같은 화면 맥락을
 * 긴 Alert 대신 얇은 한 줄로 보여준다. 클릭 액션 결과(성공/실패)는 Toast 를 쓴다.
 */
const TONE: Record<StatusBannerTone, string> = {
  info: 'border-danger-border bg-danger-surface text-brand',
  warning: 'border-warning-border bg-warning-surface text-warning',
  danger: 'border-danger-border bg-danger-surface text-danger',
  neutral: 'border-border bg-muted text-neutral-base',
};

export function StatusBanner({
  tone = 'neutral',
  label,
  detail,
  action,
  className = '',
}: StatusBannerProps) {
  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${TONE[tone]} ${className}`}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-semibold">{label}</span>
        {detail != null && <span className="text-xs opacity-80">{detail}</span>}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
