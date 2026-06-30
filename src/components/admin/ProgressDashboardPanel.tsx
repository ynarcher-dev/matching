import { useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Modal } from '@/components/common/Modal';
import { Toggle } from '@/components/common/Toggle';
import { StatBox } from '@/components/common/StatBox';
import { TimeGridSheet } from '@/components/admin/TimeGridSheet';
import { CompanyPhotoUploadPanel } from '@/components/staff/CompanyPhotoUploadPanel';
import { useEventSlots } from '@/hooks/useEventDetail';
import {
  DASHBOARD_POLL_MS,
  useMarkNoShow,
  useSetSessionStatus,
} from '@/hooks/useEventDashboard';
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
}: ProgressDashboardPanelProps) {
  const slotsQ = useEventSlots(eventId, { refetchInterval: DASHBOARD_POLL_MS });
  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  const progress = useMemo(() => computeProgressStats(slots), [slots]);

  const noShow = useMarkNoShow(eventId);
  const setSessionStatus = useSetSessionStatus(eventId);
  const [noShowTarget, setNoShowTarget] = useState<MatchingSlotRow | null>(null);

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
    : null;

  const noShowStartup = noShowTarget?.startup_id
    ? userById.get(noShowTarget.startup_id)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-neutral-base">실시간 진행 현황</h2>
          <Badge
            tone="success"
            size="11"
            icon={<span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
          >
            LIVE {Math.round(DASHBOARD_POLL_MS / 1000)}초마다 새로 갱신됩니다.
          </Badge>
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
          onOpenPhotos={(slot) => slot.startup_id && setPhotoTarget(slot.startup_id)}
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
