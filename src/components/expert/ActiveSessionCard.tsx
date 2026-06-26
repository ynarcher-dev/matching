import { useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { CountdownTimer } from '@/components/expert/CountdownTimer';
import { SessionStatusBadge } from '@/components/expert/SessionStatusBadge';
import { ExpertAttendanceControl } from '@/components/expert/ExpertAttendanceControl';
import { getProposalSignedUrl } from '@/hooks/useExpertPortal';
import { formatRange } from '@/lib/datetime';
import type { AttendanceStatus } from '@/types/attendance';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { SlotStartup } from '@/types/expert';

/**
 * 진행 중/다가오는 세션 강조 카드 (docs/page_expert_dashboard.md §1.2).
 * 스타트업 정보·소개서·테이블·카운트다운 + 본인/스타트업 출석 + 상담 시작/일지 버튼.
 */
export function ActiveSessionCard({
  slot,
  startup,
  tableCode,
  timezone,
  expertId,
  expertAttendance,
  startupAttendance,
  onSetAttendance,
  onClearAttendance,
  attendancePending,
  onStart,
  startPending,
  startError,
  onWriteLog,
}: {
  slot: MatchingSlotRow;
  startup: SlotStartup | undefined;
  tableCode: string | undefined;
  timezone: string;
  expertId: string;
  expertAttendance: AttendanceStatus | null;
  startupAttendance: AttendanceStatus | null;
  onSetAttendance: (params: {
    slotId: string;
    userId: string;
    roleType: 'EXPERT' | 'STARTUP';
    status: AttendanceStatus;
  }) => void;
  onClearAttendance: (params: {
    slotId: string;
    userId: string;
    roleType: 'EXPERT' | 'STARTUP';
  }) => void;
  attendancePending: boolean;
  onStart: (slotId: string) => void;
  startPending: boolean;
  startError: string | null;
  onWriteLog?: (slot: MatchingSlotRow) => void;
}) {
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);

  const inProgress = slot.session_status === 'IN_PROGRESS';
  const waiting = slot.session_status === 'WAITING';
  const companyTitle = startup?.companyName ?? startup?.name ?? '스타트업';

  const openProposal = async () => {
    if (!startup?.proposalFileUrl) return;
    setProposalError(null);
    setProposalLoading(true);
    try {
      const url = await getProposalSignedUrl(startup.proposalFileUrl);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setProposalError((e as Error).message);
    } finally {
      setProposalLoading(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 border-l-4 border-l-brand p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand">
            {inProgress ? '진행 중인 상담' : '다음 상담'}
          </span>
          <h2 className="text-xl font-bold text-neutral-base">{companyTitle}</h2>
          {startup?.representativeName && (
            <p className="text-sm text-neutral-base/80">대표 {startup.representativeName}</p>
          )}
        </div>
        {inProgress ? (
          <CountdownTimer endIso={slot.end_time} />
        ) : (
          <SessionStatusBadge status={slot.session_status} />
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-base/80">
        <span>🕒 {formatRange(slot.start_time, slot.end_time, timezone)}</span>
        {tableCode && <span>📍 {tableCode} 테이블</span>}
      </div>

      {startup?.description && (
        <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-sm text-neutral-base/90">
          {startup.description}
        </p>
      )}

      {startup?.proposalFileUrl && (
        <div className="flex flex-col gap-1">
          <Button variant="outline" onClick={openProposal} loading={proposalLoading} className="self-start">
            📄 사업소개서 보기
          </Button>
          {proposalError && <Alert tone="error">{proposalError}</Alert>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ExpertAttendanceControl
          label="본인 출석"
          status={expertAttendance}
          disabled={attendancePending}
          onSet={(status) =>
            onSetAttendance({ slotId: slot.id, userId: expertId, roleType: 'EXPERT', status })
          }
          onClear={() => onClearAttendance({ slotId: slot.id, userId: expertId, roleType: 'EXPERT' })}
        />
        {slot.startup_id && (
          <ExpertAttendanceControl
            label="스타트업 출석"
            status={startupAttendance}
            disabled={attendancePending}
            onSet={(status) =>
              onSetAttendance({
                slotId: slot.id,
                userId: slot.startup_id as string,
                roleType: 'STARTUP',
                status,
              })
            }
            onClear={() =>
              onClearAttendance({
                slotId: slot.id,
                userId: slot.startup_id as string,
                roleType: 'STARTUP',
              })
            }
          />
        )}
      </div>

      {startError && <Alert tone="error">{startError}</Alert>}

      <div className="flex flex-wrap gap-2">
        {waiting && (
          <Button
            onClick={() => onStart(slot.id)}
            loading={startPending}
            className="px-6 py-4 text-lg"
          >
            상담 시작
          </Button>
        )}
        {(inProgress || slot.session_status === 'COMPLETED') && onWriteLog && (
          <Button
            variant={inProgress ? 'primary' : 'outline'}
            onClick={() => onWriteLog(slot)}
            className="px-6 py-4 text-lg"
          >
            {slot.session_status === 'COMPLETED' ? '상담일지 수정' : '상담일지 작성하기'}
          </Button>
        )}
      </div>
    </Card>
  );
}
