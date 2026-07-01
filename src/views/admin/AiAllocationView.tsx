import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { AllocationToolbar } from '@/components/admin/AllocationToolbar';
import { AllocationSlotBoard } from '@/components/admin/AllocationSlotBoard';
import { UnmatchedPanel } from '@/components/admin/UnmatchedPanel';
import {
  useAssignableUsers,
  useEventDetail,
  useEventParticipants,
  useEventSlots,
} from '@/hooks/useEventDetail';
import {
  useConfirmProposals,
  useEventProposals,
  useGenerateProposals,
  useMoveProposal,
  useToggleProposalLock,
} from '@/hooks/useAiAllocation';
import { summarizeProposals } from '@/lib/allocation';
import { toast } from '@/stores/toastStore';
import type { AssignableUser } from '@/types/eventDetail';
import type { ConfirmResult } from '@/types/aiAllocation';

/**
 * AI 자동배치 검토 화면 (page_admin_ai_allocation.md).
 * 제안 생성(그리디)·시간표 시각화·부분 확정을 한 화면에서 처리한다.
 * 활성 조건: 행사 ALLOCATION(배치 조율) 단계. 그 외에는 조회만.
 */
export function AiAllocationView() {
  const { eventId = '' } = useParams();
  const eventQ = useEventDetail(eventId);
  const slotsQ = useEventSlots(eventId);
  const participantsQ = useEventParticipants(eventId);
  const usersQ = useAssignableUsers();
  const proposalsQ = useEventProposals(eventId);

  const generate = useGenerateProposals(eventId);
  const confirm = useConfirmProposals(eventId);
  const lock = useToggleProposalLock(eventId);
  const move = useMoveProposal(eventId);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [report, setReport] = useState<ConfirmResult | null>(null);

  const userById = useMemo(
    () => new Map<string, AssignableUser>((usersQ.data ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );

  const proposals = useMemo(() => proposalsQ.data ?? [], [proposalsQ.data]);
  const summary = useMemo(() => summarizeProposals(proposals), [proposals]);

  if (eventQ.isLoading) return <FullScreenLoader />;
  if (eventQ.isError || !eventQ.data) {
    return (
      <Card className="p-6">
        <Alert tone="error">
          행사를 불러오지 못했습니다.{' '}
          {(eventQ.error as Error | null)?.message ?? '존재하지 않는 행사입니다.'}
        </Alert>
      </Card>
    );
  }

  const event = eventQ.data;
  const isAllocation = event.status === 'ALLOCATION';
  const slots = slotsQ.data ?? [];
  const busy = generate.isPending || confirm.isPending || lock.isPending || move.isPending;

  return (
    <div className="flex flex-col gap-5">
      <AllocationToolbar
        eventId={eventId}
        eventTitle={event.title}
        summary={summary}
        active={isAllocation}
        hasMatched={isAllocation && summary.matched > 0}
        generating={generate.isPending}
        confirming={confirm.isPending}
        onGenerate={() => {
          setReport(null);
          generate.mutate(undefined, {
            onSuccess: (data) =>
              toast.success('AI 제안을 생성했습니다.', {
                description: `제안 ${data.matched}건 · 미배치 ${data.unmatched}건 · 고정 보존 ${data.locked}건`,
              }),
            onError: (e) =>
              toast.error('AI 제안을 생성하지 못했습니다.', { description: (e as Error).message }),
          });
        }}
        onConfirm={() => setConfirmOpen(true)}
      />

      {!isAllocation && (
        <Alert tone="info">
          AI 자동배치는 행사가 <strong>배치 조율(ALLOCATION)</strong> 단계일 때만 생성·확정할 수
          있습니다. (현재: {event.status}) 아래는 조회 전용입니다.
        </Alert>
      )}

      {(slotsQ.isError || participantsQ.isError || usersQ.isError || proposalsQ.isError) && (
        <Alert tone="error">일부 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {report && <ConfirmReport report={report} eventId={eventId} />}

      <AllocationSlotBoard
        slots={slots}
        proposals={proposals}
        userById={userById}
        timezone={event.timezone}
        busy={busy || !isAllocation}
        onToggleLock={(id, next) =>
          lock.mutate(
            { id, locked: next },
            {
              onError: (e) =>
                toast.error('고정을 변경하지 못했습니다.', { description: (e as Error).message }),
            },
          )
        }
        onMove={(id, slotId) =>
          move.mutate(
            { id, slotId },
            {
              onError: (e) =>
                toast.error('제안을 이동하지 못했습니다.', { description: (e as Error).message }),
            },
          )
        }
      />

      <UnmatchedPanel proposals={proposals} userById={userById} />

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="배치 제안안 확정"
        message="배정된 AI 제안을 실제 매칭 슬롯에 반영합니다. 충돌이 발생한 제안은 제외하고 정상 건만 부분 확정되며, 제외 사유는 리포트로 표시됩니다."
        confirmLabel="확정"
        loading={confirm.isPending}
        onConfirm={() => {
          confirm.mutate(undefined, {
            onSuccess: (res) => {
              setReport(res);
              setConfirmOpen(false);
            },
            onError: (e) =>
              toast.error('AI 제안을 확정하지 못했습니다.', { description: (e as Error).message }),
          });
        }}
      />
    </div>
  );
}

/** 확정 결과 리포트(부분 확정: 반영/제외 + 충돌 사유). */
function ConfirmReport({ report, eventId }: { report: ConfirmResult; eventId: string }) {
  const clean = report.skipped === 0;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-neutral-base">확정 결과</h3>
        <Link
          to={`/admin/events/${eventId}`}
          className="text-sm font-semibold text-brand hover:underline"
        >
          행사 상세로 이동 →
        </Link>
      </div>
      <Alert tone={clean ? 'success' : 'info'}>
        {report.applied}건을 매칭 슬롯에 반영했습니다.
        {report.skipped > 0 && ` ${report.skipped}건은 충돌로 제외되었습니다.`}
      </Alert>
      {report.conflicts.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border text-sm">
          {report.conflicts.map((c) => (
            <li key={c.proposal_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs text-neutral-base/60">
                슬롯 {c.slot_id.slice(0, 8)}
              </span>
              <span className="text-brand">{c.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
