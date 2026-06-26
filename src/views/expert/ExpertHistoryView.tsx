import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { CounselingLogSummary } from '@/components/expert/CounselingLogSummary';
import { useAuthStore } from '@/stores/authStore';
import { useExpertHistory } from '@/hooks/useExpertPortal';
import { formatRange } from '@/lib/datetime';

/**
 * 이전 상담 이력 (docs/page_expert_dashboard.md §3 — 과거 상담일지 조회).
 * 전 행사 통합, 완료(COMPLETED) 세션을 최신순으로 읽기 전용 표시.
 */
export function ExpertHistoryView() {
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';
  const historyQ = useExpertHistory(myId);

  if (historyQ.isLoading) return <FullScreenLoader />;
  if (historyQ.isError) {
    return (
      <Card className="p-6">
        <Alert tone="error">
          상담 이력을 불러오지 못했습니다. {(historyQ.error as Error | null)?.message ?? ''}
        </Alert>
      </Card>
    );
  }

  const items = historyQ.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-1 p-5">
        <h1 className="text-lg font-bold text-neutral-base">이전 상담 이력</h1>
        <p className="text-sm text-neutral-base/70">완료된 상담 세션과 작성한 상담일지를 확인합니다.</p>
      </Card>

      {items.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-neutral-base/60">완료된 상담 이력이 없습니다.</p>
        </Card>
      ) : (
        items.map((item) => (
          <Card key={item.slot.id} className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-base font-bold text-neutral-base">{item.startupName}</span>
                <span className="text-xs text-neutral-base/60">{item.eventTitle}</span>
              </div>
              <span className="text-xs text-neutral-base/60">
                {formatRange(item.slot.start_time, item.slot.end_time, item.eventTimezone)}
              </span>
            </div>
            <CounselingLogSummary
              log={item.log}
              questions={item.questions}
              answers={item.answers}
            />
          </Card>
        ))
      )}
    </div>
  );
}
