import { useMemo, useState, useEffect } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Modal } from '@/components/common/Modal';
import { Toggle } from '@/components/common/Toggle';
import { StatBox } from '@/components/common/StatBox';
import { TimeGridSheet } from '@/components/admin/TimeGridSheet';
import { ReplaceNoShowModal } from '@/components/admin/ReplaceNoShowModal';
import { CompanyPhotoUploadPanel } from '@/components/staff/CompanyPhotoUploadPanel';
import { useEventSlots } from '@/hooks/useEventDetail';
import {
  DASHBOARD_POLL_MS,
  useMarkNoShow,
  useSetSessionStatus,
  useReplaceNoShow,
} from '@/hooks/useEventDashboard';
import { useSetTableManager } from '@/hooks/useEventDetailMutations';
import { useEventOperators } from '@/hooks/useOperators';
import { useEventCompanyPhotos } from '@/hooks/useCompanyPhotos';
import { computeProgressStats } from '@/lib/booking';
import { participantLabel, SESSION_STATUS_TONE } from '@/lib/labels';
import { BADGE_TONE } from '@/lib/tone';
import type {
  AssignableUser,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';
import type { CompanyPhotoRow, PhotoCompany } from '@/types/companyPhoto';

interface ProgressDashboardPanelProps {
  eventId: string;
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  locked: boolean;
  /** 테이블 담당자 지정 권한(OWNER/MANAGER). 1열 담당자 셀렉트 편집 가능 여부. */
  canManage: boolean;
}

/**
 * 진행(PROGRESS) 단계 실시간 대시보드 패널 (page_admin_event_detail.md §3.1).
 * 슬롯·출석을 폴링으로 근실시간 갱신하고, 타임그리드로 진행/출석을 감시·조작한다.
 * 슬롯은 자체 폴링 쿼리를 사용(패널이 마운트된 동안에만 폴링).
 */
export function ProgressDashboardPanel({
  eventId,
  participants,
  tables,
  userById,
  timezone,
  locked,
  canManage,
}: ProgressDashboardPanelProps) {
  const slotsQ = useEventSlots(eventId, { refetchInterval: DASHBOARD_POLL_MS });
  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  const progress = useMemo(() => computeProgressStats(slots), [slots]);

  const noShow = useMarkNoShow(eventId);
  const setSessionStatus = useSetSessionStatus(eventId);
  const [noShowTarget, setNoShowTarget] = useState<MatchingSlotRow | null>(null);

  const replaceNoShow = useReplaceNoShow(eventId);
  const [replaceTarget, setReplaceTarget] = useState<MatchingSlotRow | null>(null);

  // 테이블 현장 담당자(1열 하단 셀렉트) — 후보 = 행사 배정 오퍼레이터(STAFF+).
  const setTableManager = useSetTableManager(eventId);
  const operatorsQ = useEventOperators(eventId);
  const managerOptions = useMemo(
    () =>
      (operatorsQ.data ?? []).map((o) => ({ userId: o.user_id, name: o.operator_name })),
    [operatorsQ.data],
  );
  const managerByTable = useMemo(
    () => new Map(tables.map((t) => [t.id, t.manager_user_id])),
    [tables],
  );

  // 현장 대기 후보 = 행사 참가 스타트업(AssignableUser).
  const startupUsers = useMemo<AssignableUser[]>(
    () =>
      participants
        .filter((p) => p.participant_type === 'STARTUP')
        .map((p) => userById.get(p.user_id))
        .filter((u): u is AssignableUser => !!u),
    [participants, userById],
  );

  // 새로고침 남은 시간 타이머 (5분 = 300초)
  const [timeLeft, setTimeLeft] = useState(300);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          slotsQ.refetch();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [slotsQ]);

  // 데이터 갱신 시 타이머 리셋
  useEffect(() => {
    setTimeLeft(300);
  }, [slotsQ.data]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // 증빙사진 통합(ideation §3): 진행 현황판에서 셀별로 바로 업로드/검수한다.
  // 사진은 (행사 × 스타트업 company_user_id) 단위 — 한 스타트업의 모든 셀이 같은 사진 묶음을 공유한다.
  const photosQ = useEventCompanyPhotos(eventId);
  const photosByStartup = useMemo(() => {
    const m = new Map<string, CompanyPhotoRow[]>();
    for (const p of photosQ.data ?? []) {
      const arr = m.get(p.company_user_id);
      if (arr) arr.push(p);
      else m.set(p.company_user_id, [p]);
    }
    return m;
  }, [photosQ.data]);
  const photoCountByStartup = useMemo(() => {
    const m = new Map<string, number>();
    photosByStartup.forEach((arr, k) => m.set(k, arr.length));
    return m;
  }, [photosByStartup]);

  const [photoFilter, setPhotoFilter] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);
  const photoCompany = useMemo<PhotoCompany | null>(() => {
    if (!photoTarget) return null;
    const u = userById.get(photoTarget);
    return {
      userId: photoTarget,
      companyName: u?.company_name || u?.name || '(이름 미상)',
      contactName: u?.representative_name || u?.name || '',
    };
  }, [photoTarget, userById]);

  const pending = noShow.isPending || setSessionStatus.isPending;
  const actionError = setSessionStatus.isError
    ? (setSessionStatus.error as Error).message
    : setTableManager.isError
      ? (setTableManager.error as Error).message
      : null;

  const noShowStartup = noShowTarget?.startup_id
    ? userById.get(noShowTarget.startup_id)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-neutral-base">실시간 진행 현황</h2>
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-base">
            <span className="flex items-center gap-1.5 rounded-full bg-danger-surface px-2.5 py-1 text-[11px] font-bold text-danger border border-danger-border">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
              LIVE
            </span>
            <span>{formatTime(timeLeft)} 후 자동 갱신</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatBox label="총 진행 세션" value={progress.total} />
          <StatBox label="대기중 세션" value={progress.waiting} />
          <StatBox label="진행중 세션" value={progress.inProgress} tone="info" />
          <StatBox label="완료 세션" value={progress.completed} tone="success" />
          <StatBox
            label="잔여 세션"
            value={progress.remaining}
            tone={progress.remaining > 0 ? 'warning' : 'success'}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Legend className={BADGE_TONE[SESSION_STATUS_TONE.WAITING]} label="대기중" />
          <Legend className={BADGE_TONE[SESSION_STATUS_TONE.IN_PROGRESS]} label="진행중" />
          <Legend className={BADGE_TONE[SESSION_STATUS_TONE.COMPLETED]} label="완료" />
          <Legend className={BADGE_TONE[SESSION_STATUS_TONE.NO_SHOW]} label="노쇼" />
          <span className="ml-1 text-neutral-base/50">
            · 셀 색은 진행 상태입니다. 각 셀에서 대기중/진행중/완료를 직접 전환하면 출석이 자동 처리되고(진행·완료=출석, 노쇼=불참), 노쇼는 사유 버튼으로, 전문가 상담일지는 별도로 제출됩니다. 셀 하단 📷 버튼으로 증빙사진을 바로 등록·검수합니다.
          </span>
          <label className="ml-auto inline-flex items-center gap-2 text-neutral-base/70">
            <Toggle
              checked={photoFilter}
              onChange={setPhotoFilter}
              label="사진 미등록 셀만 보기"
            />
            <span className="font-semibold">📷 사진 미등록 셀만 보기</span>
          </label>
        </div>

        {slotsQ.isError && (
          <Alert tone="error">슬롯을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>
        )}
        {actionError && <Alert tone="error">{actionError}</Alert>}

        <TimeGridSheet
          slots={slots}
          participants={participants}
          tables={tables}
          userById={userById}
          timezone={timezone}
          locked={locked}
          pending={pending}
          photoCountByStartup={photoCountByStartup}
          photoFilter={photoFilter}
          onMarkNoShow={setNoShowTarget}
          onSetSessionStatus={(slot, status) =>
            setSessionStatus.mutate({ slotId: slot.id, status })
          }
          onReplaceNoShow={setReplaceTarget}
          onOpenPhotos={(slot) => slot.startup_id && setPhotoTarget(slot.startup_id)}
          operators={managerOptions}
          managerByTable={managerByTable}
          onSetTableManager={(tableId, userId) =>
            setTableManager.mutate({ tableId, userId })
          }
          canManage={canManage}
          managerPending={setTableManager.isPending}
        />
      </Card>

      <ConfirmModal
        open={noShowTarget !== null}
        onClose={() => setNoShowTarget(null)}
        title="노쇼 처리"
        message={
          noShowStartup
            ? `${participantLabel(noShowStartup)} 세션을 노쇼(불참)로 처리합니다. 사유는 감사 로그에 기록됩니다.`
            : '이 세션을 노쇼(불참)로 처리합니다. 사유는 감사 로그에 기록됩니다.'
        }
        confirmLabel="노쇼 처리"
        requireReason
        reasonLabel="노쇼 사유"
        loading={noShow.isPending}
        error={noShow.isError ? (noShow.error as Error).message : null}
        onConfirm={(reason) => {
          if (noShowTarget) {
            noShow.mutate(
              { slotId: noShowTarget.id, reason },
              { onSuccess: () => setNoShowTarget(null) },
            );
          }
        }}
      />

      {/* 현장 대체 매칭 모달 */}
      <ReplaceNoShowModal
        open={replaceTarget !== null}
        onClose={() => setReplaceTarget(null)}
        slot={replaceTarget}
        slots={slots}
        startups={startupUsers}
        userById={userById}
        tables={tables}
        timezone={timezone}
        loading={replaceNoShow.isPending}
        error={replaceNoShow.isError ? (replaceNoShow.error as Error).message : null}
        onConfirm={(startupId: string, reason: string) => {
          if (replaceTarget) {
            replaceNoShow.mutate(
              { slotId: replaceTarget.id, startupId, reason },
              { onSuccess: () => setReplaceTarget(null) },
            );
          }
        }}
      />

      {/* 증빙사진 등록/검수 모달(ideation §3) — 셀에서 바로 열어 CompanyPhotoUploadPanel 재사용. */}
      <Modal
        open={photoCompany !== null}
        onClose={() => setPhotoTarget(null)}
        title="증빙사진"
        size="md"
      >
        {photoCompany && (
          <CompanyPhotoUploadPanel
            eventId={eventId}
            company={photoCompany}
            photos={photosByStartup.get(photoCompany.userId) ?? []}
          />
        )}
      </Modal>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-neutral-base/70">
      <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold ${className}`}>
        {label}
      </span>
    </span>
  );
}
