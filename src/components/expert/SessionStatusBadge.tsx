import { SESSION_STATUS_LABELS } from '@/lib/labels';
import type { SessionStatus } from '@/types/eventDetail';

/** 세션 상태별 배지 톤(아이콘+텍스트 병기, page_expert_dashboard.md §1.2). */
const TONE: Record<SessionStatus, string> = {
  WAITING: 'border-border bg-surface text-neutral-base/80',
  IN_PROGRESS: 'border-blue-300 bg-info-surface text-blue-700',
  COMPLETED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  NO_SHOW: 'border-brand/30 bg-brand/5 text-brand',
  CANCELLED: 'border-border bg-muted text-neutral-base/50',
};

const ICON: Record<SessionStatus, string> = {
  WAITING: '⏳',
  IN_PROGRESS: '▶',
  COMPLETED: '✓',
  NO_SHOW: '✕',
  CANCELLED: '—',
};

/** 세션 진행 상태 배지(색상+아이콘+한국어 라벨). */
export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[status]}`}
    >
      <span aria-hidden>{ICON[status]}</span>
      {SESSION_STATUS_LABELS[status]}
    </span>
  );
}
