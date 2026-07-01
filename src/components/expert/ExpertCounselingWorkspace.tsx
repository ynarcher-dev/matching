import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { ResizableSplit } from '@/components/common/ResizableSplit';
import { CompanyInfoPanel } from '@/components/expert/CompanyInfoPanel';
import { CounselingLogForm } from '@/components/expert/CounselingLogForm';
import { formatRange } from '@/lib/datetime';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { SlotStartup } from '@/types/expert';

/**
 * 전문가 상담 워크스페이스 (docs/expert_dashboard_split_view_ideation.md §2B).
 * 리사이저블 Split(기업 정보 ↔ 상담일지)이 화면을 꽉 채운다.
 * IR 자료 검토와 일지 작성을 한 캔버스에서 동시에 수행한다.
 * 다른 일정으로 전환은 상단 "전체 일정으로 돌아가기"로 일정 표에서 다시 연다.
 */
export function ExpertCounselingWorkspace({
  slots,
  currentSlotId,
  startupById,
  timezone,
  eventId,
  inProgress,
  onBack,
  onStart,
  startPending,
  startError,
  onRefreshStartups,
}: {
  slots: MatchingSlotRow[];
  currentSlotId: string;
  startupById: Map<string, SlotStartup>;
  timezone: string;
  eventId: string;
  /** 행사 진행(PROGRESS) 단계 여부 — 상담 시작 가능 조건. */
  inProgress: boolean;
  onBack: () => void;
  onStart: (slotId: string) => void;
  startPending: boolean;
  startError: string | null;
  /** 스타트업 자료(소개서 경로·파일명) 원천 쿼리 refetch — [자료] 새로고침에 연결. */
  onRefreshStartups?: () => Promise<unknown>;
}) {
  const slot = slots.find((s) => s.id === currentSlotId);
  if (!slot) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton onBack={onBack} />
        <Alert tone="error">선택한 상담 일정을 찾을 수 없습니다.</Alert>
      </div>
    );
  }

  const startup = slot.startup_id ? startupById.get(slot.startup_id) : undefined;
  const companyTitle = startup?.companyName ?? startup?.name ?? '스타트업';

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[560px] flex-col gap-3">
      {/* 상단 바: (좌) 돌아가기 / (우) 기업명·대표명·진행시간 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <BackButton onBack={onBack} />
        <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
          <span className="truncate text-base font-bold text-neutral-base">{companyTitle}</span>
          {startup?.representativeName && (
            <span className="text-sm text-neutral-base/70">대표 {startup.representativeName}</span>
          )}
          <span className="text-sm font-medium text-neutral-base/80">
            {formatRange(slot.start_time, slot.end_time, timezone)}
          </span>
        </div>
      </div>

      {/* Split: 기업 정보 ↔ 상담일지 (화면 전체 폭) */}
      <div className="min-h-0 min-w-0 flex-1">
        <ResizableSplit
          className="h-full"
          initialRatio={2 / 3}
          minRatio={0.25}
          left={
            <CompanyInfoPanel
              startup={startup}
              counselingRequest={slot.counseling_request}
              onRefresh={onRefreshStartups}
            />
          }
          right={
            <div className="h-full overflow-hidden rounded-xl border border-border bg-surface-raised">
              <LogPane
                slot={slot}
                eventId={eventId}
                inProgress={inProgress}
                onStart={onStart}
                startPending={startPending}
                startError={startError}
                onBack={onBack}
              />
            </div>
          }
        />
      </div>
    </div>
  );
}

/** 우측 일지 영역: WAITING 은 상담 시작 프롬프트, 그 외는 일지 폼. */
function LogPane({
  slot,
  eventId,
  inProgress,
  onStart,
  startPending,
  startError,
  onBack,
}: {
  slot: MatchingSlotRow;
  eventId: string;
  inProgress: boolean;
  onStart: (slotId: string) => void;
  startPending: boolean;
  startError: string | null;
  onBack: () => void;
}) {
  if (slot.session_status === 'WAITING') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-base font-bold text-neutral-base">상담을 시작해 주세요</p>
          <p className="text-sm text-neutral-base/60">
            상담을 시작하면 자동으로 출석 처리되고 일지를 작성할 수 있습니다.
          </p>
        </div>
        {inProgress ? (
          <Button size="lg" onClick={() => onStart(slot.id)} loading={startPending}>
            상담 시작
          </Button>
        ) : (
          <Alert tone="info">진행(PROGRESS) 단계에서 상담을 시작할 수 있습니다.</Alert>
        )}
        {startError && <Alert tone="error">{startError}</Alert>}
      </div>
    );
  }

  if (slot.session_status === 'NO_SHOW' || slot.session_status === 'CANCELLED') {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-base/60">
        {slot.session_status === 'NO_SHOW' ? '노쇼 처리된 세션입니다.' : '취소된 세션입니다.'}
      </div>
    );
  }

  // IN_PROGRESS / COMPLETED → 일지 폼. 수동 임시저장 성공 시 전체 일정으로 복귀.
  return <CounselingLogForm slot={slot} eventId={eventId} onSaved={onBack} />;
}

/** 상단 뒤로가기 — 관리자 EventDetailHeader 의 '← 목록' 텍스트 링크와 동일 스타일. */
function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="self-start text-sm font-semibold text-neutral-base/70 transition-colors hover:text-brand"
    >
      ← 전체 일정으로 돌아가기
    </button>
  );
}
