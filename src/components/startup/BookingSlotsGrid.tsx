import { useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';
import { ExpertBookingList } from './ExpertBookingList';
import { TimeMatrixGrid } from './TimeMatrixGrid';

interface BookingSlotsGridProps {
  experts: PortalExpert[];
  slots: MatchingSlotRow[];
  /** 전문가 userId → 프로필 사진 Signed URL(전문가별 보기). */
  avatarUrls: Map<string, string>;
  /** 전문가 기본 테이블 id → 테이블 코드(위치 표기용). */
  tableCodeById: Map<string, string>;
  myId: string;
  maxSessions: number;
  /** 행사 설정: 동일 전문가 2회 이상 예약 허용. */
  allowDuplicateExpert: boolean;
  timezone: string;
  /** BOOKING 단계에서만 신규 예약 가능. */
  canBook: boolean;
  onBook: (slot: MatchingSlotRow) => void;
}

type GridTab = 'time' | 'expert';

const GRID_TABS: { value: GridTab; label: string }[] = [
  { value: 'time', label: '시간대별 보기' },
  { value: 'expert', label: '전문가별 보기' },
];

/**
 * 예약 신청 일정표 (page_startup_booking.md §1.2-3, §1.3).
 * - **시간대별 보기**(기본): 전문가(행)×시간(열) 매트릭스 표 — 빠른 예약 탐색용(`TimeMatrixGrid`).
 * - **전문가별 보기**: 전문가 정보 카드(사진·소속·직책·분야·소개)를 먼저 보여주고
 *   그 전문가의 가능 시간대를 함께 노출(`ExpertBookingList`).
 * 빈 슬롯=민트(신청)·내 예약=강조·마감/신청 불가=회색.
 */
export function BookingSlotsGrid({
  experts,
  slots,
  avatarUrls,
  tableCodeById,
  myId,
  maxSessions,
  allowDuplicateExpert,
  timezone,
  canBook,
  onBook,
}: BookingSlotsGridProps) {
  const [tab, setTab] = useState<GridTab>('time');

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-base">예약 신청 일정표</h2>
        <div className="flex gap-1.5">
          {GRID_TABS.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-white text-neutral-base hover:bg-surface'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-neutral-base/60">
        {tab === 'time'
          ? '시간 기준으로 빠르게 빈 슬롯을 찾아 신청합니다.'
          : '전문가 정보를 살펴보고 가능한 시간대를 선택해 신청합니다.'}
      </p>

      <Legend />

      {!canBook && (
        <Alert tone="info">
          현재 예약 단계가 아니어서 새 슬롯을 신청할 수 없습니다. 예약(BOOKING) 단계에서 신청할 수 있습니다.
        </Alert>
      )}

      {tab === 'expert' ? (
        <ExpertBookingList
          experts={experts}
          slots={slots}
          avatarUrls={avatarUrls}
          tableCodeById={tableCodeById}
          myId={myId}
          maxSessions={maxSessions}
          allowDuplicateExpert={allowDuplicateExpert}
          timezone={timezone}
          canBook={canBook}
          onBook={onBook}
        />
      ) : (
        <TimeMatrixGrid
          experts={experts}
          slots={slots}
          tableCodeById={tableCodeById}
          myId={myId}
          maxSessions={maxSessions}
          allowDuplicateExpert={allowDuplicateExpert}
          timezone={timezone}
          canBook={canBook}
          onBook={onBook}
        />
      )}
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-neutral-base/70">
      <LegendItem className="border-success bg-surface-raised" label="신청 가능" />
      <LegendItem className="border-success bg-success" label="내 예약" />
      <LegendItem className="border-border bg-surface" label="마감 / 신청 불가" />
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3.5 w-3.5 rounded border ${className}`} />
      {label}
    </span>
  );
}
