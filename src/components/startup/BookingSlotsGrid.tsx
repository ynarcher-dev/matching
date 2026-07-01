import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { FilterChips } from '@/components/common/FilterBar';
import { formatDateTime } from '@/lib/datetime';
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
  /** 슬롯 수동 새로고침(그 사이 타 기업 예약 여부 확인용). */
  onRefresh?: () => void;
  /** 새로고침 진행 중(버튼 로딩 표시). */
  refreshing?: boolean;
}

type GridTab = 'time' | 'expert';

/** 시각만(HH:mm) 표기 — 시간 조회 매칭·표시 통일용. */
function hhmm(iso: string, tz: string): string {
  return formatDateTime(iso, tz).slice(-5);
}

/** "HH:mm" → 자정 기준 분. */
function minutesOf(hhmmStr: string): number {
  const [h, m] = hhmmStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 시간 범위 입력 파싱. "14"/"14:30" 모두 허용.
 * 시(hour)만 입력하면 시작 경계는 :00, 종료 경계는 :59 로 해석해 그 시간대 전체를 포함한다.
 * 형식이 맞지 않으면 null(해당 경계 필터 미적용).
 */
function parseBoundMin(input: string, isEnd: boolean): number | null {
  const s = input.trim();
  if (!s) return null;
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!match) return null;
  const h = Math.min(23, Number(match[1]));
  const m = match[2] != null ? Math.min(59, Number(match[2])) : isEnd ? 59 : 0;
  return h * 60 + m;
}

/** 툴바 입력(검색·시간조회) 공통 스타일. SearchInput 과 동일 톤이되 고정 폭. */
const TOOLBAR_INPUT =
  'h-9 rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30';

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
  onRefresh,
  refreshing,
}: BookingSlotsGridProps) {
  const [tab, setTab] = useState<GridTab>('time');
  const [search, setSearch] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');

  // 크게보기: 이 카드만 화면 전체로 확대(풀스크린 오버레이). ESC 로 해제(관리자 예약관리와 동일).
  const [enlarged, setEnlarged] = useState(false);
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnlarged(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);

  // 검색: 전문가 이름·소속·테이블 코드·분야태그. 시간 조회: 시작시각이 [시작~종료] 범위 내.
  const q = search.trim().toLowerCase();
  const fromMin = parseBoundMin(fromTime, false);
  const toMin = parseBoundMin(toTime, true);

  const filteredExperts = useMemo(() => {
    if (!q) return experts;
    return experts.filter((e) => {
      const code = e.defaultTableId ? (tableCodeById.get(e.defaultTableId) ?? '') : '';
      const hay = [e.name, e.organization ?? '', code, ...(e.fieldNames ?? [])]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [experts, q, tableCodeById]);

  const expertIdSet = useMemo(
    () => new Set(filteredExperts.map((e) => e.userId)),
    [filteredExperts],
  );

  const filteredSlots = useMemo(() => {
    if (!q && fromMin == null && toMin == null) return slots;
    return slots.filter((s) => {
      if (q && !expertIdSet.has(s.expert_id)) return false;
      if (fromMin != null || toMin != null) {
        const startMin = minutesOf(hhmm(s.start_time, timezone));
        if (fromMin != null && startMin < fromMin) return false;
        if (toMin != null && startMin > toMin) return false;
      }
      return true;
    });
  }, [slots, q, fromMin, toMin, expertIdSet, timezone]);

  return (
    <Card
      className={`flex flex-col gap-4 p-5 ${
        enlarged ? 'fixed inset-0 z-40 m-0 max-w-none overflow-hidden rounded-none' : ''
      }`}
    >
      {/* 제목 줄: 좌측 제목 · 우측 범례 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-base">예약 신청 일정표</h2>
        <Legend />
      </div>

      {/* 툴바: (좌) 검색 → 시간 조회 → 보기 필터칩 / (우) 새로고침·크게보기 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="전문가·소속·테이블·분야 검색"
            aria-label="전문가 검색"
            className={`${TOOLBAR_INPUT} w-56`}
          />
          <div className="flex items-center gap-1.5" role="group" aria-label="시간 범위 조회">
            <input
              type="search"
              inputMode="numeric"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              placeholder="시작 (예: 14)"
              aria-label="조회 시작 시각"
              className={`${TOOLBAR_INPUT} w-28`}
            />
            <span className="text-sm text-neutral-base/50">~</span>
            <input
              type="search"
              inputMode="numeric"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              placeholder="종료 (예: 16)"
              aria-label="조회 종료 시각"
              className={`${TOOLBAR_INPUT} w-28`}
            />
          </div>
          <FilterChips<GridTab>
            value={tab}
            onChange={setTab}
            ariaLabel="일정표 보기 전환"
            options={[
              { value: 'time', label: '시간대별 보기' },
              { value: 'expert', label: '전문가별 보기' },
            ]}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {onRefresh && (
            <Button
              variant="outline"
              loading={refreshing}
              leftIcon={<span aria-hidden>↻</span>}
              onClick={onRefresh}
            >
              새로고침
            </Button>
          )}
          <Button
            variant={enlarged ? 'primary' : 'outline'}
            leftIcon={<span aria-hidden>⤢</span>}
            onClick={() => setEnlarged((v) => !v)}
          >
            {enlarged ? '크게보기 해제' : '크게보기'}
          </Button>
        </div>
      </div>

      {tab === 'expert' ? (
        <div className={enlarged ? 'min-h-0 flex-1 overflow-auto' : ''}>
          <ExpertBookingList
            experts={filteredExperts}
            slots={filteredSlots}
            avatarUrls={avatarUrls}
            tableCodeById={tableCodeById}
            myId={myId}
            maxSessions={maxSessions}
            allowDuplicateExpert={allowDuplicateExpert}
            timezone={timezone}
            canBook={canBook}
            onBook={onBook}
          />
        </div>
      ) : (
        <TimeMatrixGrid
          experts={filteredExperts}
          slots={filteredSlots}
          tableCodeById={tableCodeById}
          myId={myId}
          maxSessions={maxSessions}
          allowDuplicateExpert={allowDuplicateExpert}
          timezone={timezone}
          canBook={canBook}
          onBook={onBook}
          fillWidth={enlarged}
          search={search}
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
