import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Spinner } from '@/components/common/Spinner';
import { usePublicComments } from '@/hooks/useSatisfaction';
import { formatDateTime } from '@/lib/datetime';

/**
 * 공개 상담 코멘트 패널 (page_startup_booking.md §2.5).
 * 전문가가 공개를 허용한 본인 상담 텍스트 코멘트만 노출(내부 평가 점수는 비공개).
 * 데이터는 list_public_comments RPC 가 점수 컬럼을 제외하고 반환한다.
 */
export function PublicCommentsPanel({ eventId, timezone }: { eventId: string; timezone: string }) {
  const commentsQ = usePublicComments(eventId);
  const comments = commentsQ.data ?? [];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-neutral-base">전문가 상담 코멘트</h2>
        <p className="text-sm text-neutral-base/70">
          전문가가 공개를 허용한 코멘트만 표시되며, 내부 평가 점수는 공개되지 않습니다.
        </p>
      </div>

      {commentsQ.isLoading && (
        <div className="flex items-center justify-center py-4">
          <Spinner className="h-5 w-5" />
        </div>
      )}

      {commentsQ.isError && (
        <Alert tone="error">상담 코멘트를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {!commentsQ.isLoading && !commentsQ.isError && comments.length === 0 && (
        <p className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-neutral-base/60">
          아직 공개된 상담 코멘트가 없습니다.
        </p>
      )}

      {comments.map((c) => (
        <div key={c.slot_id} className="flex flex-col gap-1.5 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <span className="text-sm font-bold text-neutral-base">{c.expert_name} 전문가</span>
            <span className="text-xs text-neutral-base/50">
              {formatDateTime(c.start_time, timezone)}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-base/90">{c.content}</p>
        </div>
      ))}
    </Card>
  );
}
