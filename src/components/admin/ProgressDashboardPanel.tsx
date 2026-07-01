import { useMemo, useState, useEffect } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { SearchInput } from '@/components/common/FilterBar';
import { StatBox } from '@/components/common/StatBox';
import { StatCardSection } from '@/components/common/StatCardSection';
import { TimeGridSheet } from '@/components/admin/TimeGridSheet';
import { ReplaceNoShowModal } from '@/components/admin/ReplaceNoShowModal';
import { SlotDetailModal } from '@/components/admin/SlotDetailModal';
import { CompanyPhotoUploadPanel } from '@/components/staff/CompanyPhotoUploadPanel';
import { useEventSlots } from '@/hooks/useEventDetail';
import {
  DASHBOARD_POLL_MS,
  useMarkNoShow,
  useSetSessionStatus,
  useReplaceNoShow,
} from '@/hooks/useEventDashboard';
import { useEventOperators } from '@/hooks/useOperators';
import { useEventCompanyPhotos } from '@/hooks/useCompanyPhotos';
import { useFields } from '@/hooks/useFields';
import { toast } from '@/stores/toastStore';
import { computeProgressStats } from '@/lib/booking';
import { participantLabel, SESSION_STATUS_TONE } from '@/lib/labels';
import { Badge } from '@/components/common/Badge';
import { DotTag } from '@/components/common/Tag';
import type { Tone } from '@/lib/tone';
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

  const replaceNoShow = useReplaceNoShow(eventId);
  const [replaceTarget, setReplaceTarget] = useState<MatchingSlotRow | null>(null);

  // 셀 기업 정보 클릭 → 상담 신청 상세 모달.
  const [detailSlot, setDetailSlot] = useState<MatchingSlotRow | null>(null);

  // 테이블 현장 담당자 — 진행 현황에서는 이름만 표시(배정은 테이블 설정). 이름 해석용 오퍼레이터.
  const operatorsQ = useEventOperators(eventId);
  const managerOptions = useMemo(
    () => (operatorsQ.data ?? []).map((o) => ({ userId: o.user_id, name: o.operator_name })),
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

  // 분야 id → 이름(전문가 행 소속 아래 분야 태그 표시용).
  const { data: fields } = useFields();
  const fieldNameById = useMemo(
    () => new Map((fields ?? []).map((f) => [f.id, f.name])),
    [fields],
  );

  const [photoFilter, setPhotoFilter] = useState(false);
  const [search, setSearch] = useState('');
  // 크게보기: 이 그리드 카드만 화면 전체로 확대(풀스크린 오버레이).
  const [enlarged, setEnlarged] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);

  // 수동 새로고침: 데이터만 다시 불러오고(페이지 리로드 아님), 상단 자동갱신 타이머도 초기화.
  const handleRefresh = () => {
    slotsQ.refetch();
    photosQ.refetch();
    setTimeLeft(300);
  };

  // 크게보기 상태에서 ESC 로 해제.
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnlarged(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);
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

  const noShowStartup = noShowTarget?.startup_id
    ? userById.get(noShowTarget.startup_id)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <StatCardSection
        title="실시간 진행 현황"
        description="행사 진행 중 세션의 출석·진행·완료 상태를 실시간으로 집계합니다."
        actions={
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-base">
            <DotTag
              dotClassName="animate-pulse bg-danger"
              className="h-auto rounded-full border-danger-border bg-danger-surface py-1 text-[11px] font-bold text-danger"
            >
              LIVE
            </DotTag>
            <span>{formatTime(timeLeft)} 후 자동 갱신</span>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatBox label="총 진행 세션" value={progress.total} />
          <StatBox label="대기중 세션" value={progress.waiting} />
          <StatBox label="진행중 세션" value={progress.inProgress} />
          <StatBox label="완료 세션" value={progress.completed} />
          <StatBox label="잔여 세션" value={progress.remaining} />
        </div>
      </StatCardSection>

      <Card
        className={`flex flex-col gap-4 p-5 ${
          enlarged ? 'fixed inset-0 z-40 m-0 max-w-none rounded-none overflow-hidden' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Legend tone={SESSION_STATUS_TONE.WAITING} label="대기중" />
          <Legend tone={SESSION_STATUS_TONE.IN_PROGRESS} label="진행중" />
          <Legend tone={SESSION_STATUS_TONE.COMPLETED} label="완료" />
          <Legend tone={SESSION_STATUS_TONE.NO_SHOW} label="노쇼" />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="전문가·기업·대표·테이블 검색"
            widthClass="max-w-sm"
          />
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              loading={slotsQ.isFetching}
              leftIcon={<span aria-hidden>↻</span>}
              onClick={handleRefresh}
            >
              새로고침
            </Button>
            <Button
              variant={enlarged ? 'primary' : 'outline'}
              leftIcon={<span aria-hidden>⤢</span>}
              onClick={() => setEnlarged((v) => !v)}
            >
              {enlarged ? '크게보기 해제' : '크게보기'}
            </Button>
            <Button
              variant={photoFilter ? 'primary' : 'outline'}
              onClick={() => setPhotoFilter((v) => !v)}
            >
              📷 사진 미등록 셀만 보기
            </Button>
          </div>
        </div>

        {slotsQ.isError && (
          <Alert tone="error">슬롯을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>
        )}

        <TimeGridSheet
          fieldNameById={fieldNameById}
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
            setSessionStatus.mutate(
              { slotId: slot.id, status },
              {
                onSuccess: () => toast.success('세션 상태를 변경했습니다.'),
                onError: (e) =>
                  toast.error('세션 상태를 변경하지 못했습니다.', {
                    description: (e as Error).message,
                  }),
              },
            )
          }
          onReplaceNoShow={setReplaceTarget}
          onOpenPhotos={(slot) => slot.startup_id && setPhotoTarget(slot.startup_id)}
          onOpenDetail={setDetailSlot}
          operators={managerOptions}
          managerByTable={managerByTable}
          fillWidth={enlarged}
          search={search}
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
        onConfirm={(reason) => {
          if (noShowTarget) {
            noShow.mutate(
              { slotId: noShowTarget.id, reason },
              {
                onSuccess: () => {
                  setNoShowTarget(null);
                  toast.success('노쇼 처리했습니다.');
                },
                onError: (e) =>
                  toast.error('노쇼 처리하지 못했습니다.', { description: (e as Error).message }),
              },
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
        onConfirm={(startupId: string, reason: string) => {
          if (replaceTarget) {
            replaceNoShow.mutate(
              { slotId: replaceTarget.id, startupId, reason },
              {
                onSuccess: () => {
                  setReplaceTarget(null);
                  toast.success('대체 매칭을 완료했습니다.');
                },
                onError: (e) =>
                  toast.error('대체 매칭하지 못했습니다.', { description: (e as Error).message }),
              },
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

      {/* 상담 신청 상세(희망사항·첨부·링크) 모달 — 셀 기업 정보 클릭 시 열림. */}
      <SlotDetailModal
        slot={detailSlot}
        startup={detailSlot?.startup_id ? userById.get(detailSlot.startup_id) : undefined}
        expert={detailSlot ? userById.get(detailSlot.expert_id) : undefined}
        timezone={timezone}
        onClose={() => setDetailSlot(null)}
      />
    </div>
  );
}

function Legend({ tone, label }: { tone: Tone; label: string }) {
  return (
    <Badge tone={tone} size="11">
      {label}
    </Badge>
  );
}
