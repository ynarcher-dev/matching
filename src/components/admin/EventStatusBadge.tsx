import { EVENT_STATUS_LABELS } from '@/lib/labels';
import type { EventStatus } from '@/types/event';

/**
 * 행사 상태 배지 (page_admin_event_list.md §1.2 / EventStatusBadge.jsx).
 * 1px 경계선 + 연한 상태 배경으로 위계를 만든다(굵은 테두리 금지).
 */
const STATUS_STYLE: Record<EventStatus, string> = {
  DRAFT: 'border-gray-200 bg-gray-100 text-gray-600',
  BOOKING: 'border-blue-200 bg-blue-50 text-blue-700',
  ALLOCATION: 'border-violet-200 bg-violet-50 text-violet-700',
  PROGRESS: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FINISHED: 'border-border bg-muted text-neutral-base',
  CANCELLED: 'border-red-200 bg-danger-surface text-brand',
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}
    >
      {EVENT_STATUS_LABELS[status]}
    </span>
  );
}
