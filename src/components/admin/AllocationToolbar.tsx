import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import type { ProposalSummary } from '@/lib/allocation';

interface AllocationToolbarProps {
  eventId: string;
  eventTitle: string;
  summary: ProposalSummary;
  /** 행사가 ALLOCATION 단계라 생성/확정이 가능한가. */
  active: boolean;
  hasMatched: boolean;
  generating: boolean;
  confirming: boolean;
  onGenerate: () => void;
  onConfirm: () => void;
}

/**
 * AI 자동배치 상단 조작 바 (page_admin_ai_allocation.md §2.1).
 * 요약 문구 + 재계산/전체 확정/돌아가기. 확정은 매칭 제안이 있을 때만 활성화.
 */
export function AllocationToolbar({
  eventId,
  eventTitle,
  summary,
  active,
  hasMatched,
  generating,
  confirming,
  onGenerate,
  onConfirm,
}: AllocationToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-base">AI 자동배치</h1>
          <p className="mt-0.5 text-sm text-neutral-base/60">{eventTitle}</p>
        </div>
        <Link
          to={`/admin/events/${eventId}`}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-neutral-base transition-colors hover:bg-surface"
        >
          돌아가기
        </Link>
      </div>

      <p className="text-sm text-neutral-base/80">
        미매칭 스타트업 <span className="font-bold text-brand">{summary.unmatched}</span>개사 대상{' '}
        <span className="font-bold text-neutral-base">{summary.matched}</span>개의 자동 매칭 슬롯이
        제안되었습니다.
        {summary.fieldMismatch > 0 && (
          <>
            {' '}
            <span className="text-amber-600">(분야 불일치 {summary.fieldMismatch}건)</span>
          </>
        )}
        {summary.locked > 0 && (
          <>
            {' '}
            <span className="text-neutral-base/60">· 고정 {summary.locked}건</span>
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} loading={confirming} disabled={!hasMatched || generating}>
          배치 제안안 확정
        </Button>
        <Button
          variant="outline"
          onClick={onGenerate}
          loading={generating}
          disabled={!active || confirming}
        >
          새로고침(재계산)
        </Button>
      </div>
    </div>
  );
}
