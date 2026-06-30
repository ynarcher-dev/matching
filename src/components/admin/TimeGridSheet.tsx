import { useMemo } from 'react';
import { buildBookingSchedule } from '@/lib/booking';
import { formatDateTime } from '@/lib/datetime';
import { BADGE_TONE, SOLID_TONE, type Tone } from '@/lib/tone';
import {
  companyName,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_TONE,
} from '@/lib/labels';
import type {
  AssignableUser,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
  SessionStatus,
} from '@/types/eventDetail';

interface TimeGridSheetProps {
  slots: MatchingSlotRow[];
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  locked: boolean;
  /** 상태/노쇼 mutation 진행 중 — 셀 버튼 비활성. */
  pending: boolean;
  /** 노쇼 처리(사유 모달 오픈). */
  onMarkNoShow: (slot: MatchingSlotRow) => void;
  /** 진행 상태 직접 설정(대기중/진행중/완료, 관리/스태프). 출석은 상태 전환에 따라 자동 동기화된다. */
  onSetSessionStatus: (slot: MatchingSlotRow, status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED') => void;
}

/**
 * 셀 배경 = 세션 진행 상태(진행현황) 기준 (page_admin_event_detail.md §3.1).
 * 예약 경로(수동/AI/강제) 대신 진행 상태로 셀 색을 맞춘다(대기=흰색·진행중=info·완료=success·노쇼=danger).
 */
const SESSION_CELL_TINT: Record<SessionStatus, string> = {
  WAITING: 'bg-surface-raised',
  IN_PROGRESS: 'bg-info-surface',
  COMPLETED: 'bg-success-surface',
  NO_SHOW: 'bg-danger-surface',
  CANCELLED: 'bg-muted',
};

/**
 * 세션 진행 상태 배지 색 = SESSION_STATUS_TONE 의 읽기용(BADGE_TONE) 변형.
 * 범례·진행 버튼과 같은 tone 을 공유한다(대기/진행/완료/노쇼 = 같은 색).
 */
const STATUS_TONE: Record<SessionStatus, string> = {
  WAITING: BADGE_TONE[SESSION_STATUS_TONE.WAITING],
  IN_PROGRESS: BADGE_TONE[SESSION_STATUS_TONE.IN_PROGRESS],
  COMPLETED: BADGE_TONE[SESSION_STATUS_TONE.COMPLETED],
  NO_SHOW: BADGE_TONE[SESSION_STATUS_TONE.NO_SHOW],
  CANCELLED: `${BADGE_TONE[SESSION_STATUS_TONE.CANCELLED]} line-through`,
};

interface ExpertRow {
  expertId: string;
  name: string;
  org: string | null;
  tableCode: string;
}

/**
 * 실시간 진행 타임그리드 (page_admin_event_detail.md §3.1, 설계 §4 TimeGridSheet).
 * 행=전문가(테이블·이름·소속), 열=시작시각. 셀=진행 상태 배지 + 기업명·대표자명 + 진행 액션.
 * 셀 배경색은 진행 상태(진행현황) 기준. 출석은 별도 마킹 없이 진행 상태 버튼이 단일 제어한다
 * (ideation §1): 진행/완료=출석 자동, 노쇼=불참 자동. 완료는 전문가 상담일지 제출로도 처리된다.
 */
export function TimeGridSheet({
  slots,
  participants,
  tables,
  userById,
  timezone,
  locked,
  pending,
  onMarkNoShow,
  onSetSessionStatus,
}: TimeGridSheetProps) {
  const { columns, byExpert } = useMemo(() => buildBookingSchedule(slots), [slots]);

  const endByStart = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) {
      if (s.session_status === 'CANCELLED') continue;
      if (!m.has(s.start_time)) m.set(s.start_time, s.end_time);
    }
    return m;
  }, [slots]);

  const tableCodeById = useMemo(
    () => new Map(tables.map((t) => [t.id, t.table_code])),
    [tables],
  );
  const defaultTableByExpert = useMemo(
    () => new Map(participants.map((p) => [p.user_id, p.default_table_id])),
    [participants],
  );

  const expertRows = useMemo<ExpertRow[]>(() => {
    const rows = [...byExpert.keys()].map((expertId) => {
      const u = userById.get(expertId);
      const tid = defaultTableByExpert.get(expertId) ?? null;
      return {
        expertId,
        name: u?.name ?? '(알 수 없는 전문가)',
        org: u?.expert_organization ?? null,
        tableCode: tid ? (tableCodeById.get(tid) ?? '미지정') : '미지정',
      };
    });
    return rows.sort(
      (a, b) =>
        a.tableCode.localeCompare(b.tableCode, 'ko') || a.name.localeCompare(b.name, 'ko'),
    );
  }, [byExpert, userById, defaultTableByExpert, tableCodeById]);

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
        아직 생성된 슬롯이 없습니다. 배치 단계에서 시간표 슬롯을 생성하면 진행 현황이 표시됩니다.
      </p>
    );
  }

  return (
    <div className="w-fit max-w-full overflow-x-auto rounded-xl border border-border">
      <table className="border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-border bg-surface text-neutral-base">
            <th className="sticky left-0 z-10 w-44 whitespace-nowrap border-r border-border bg-surface px-3 py-2.5 font-bold">
              테이블 · 전문가
            </th>
            {columns.map((c) => {
              const end = endByStart.get(c);
              return (
                <th
                  key={c}
                  className="w-[150px] whitespace-nowrap border-r border-border px-1 py-2 text-center font-bold last:border-r-0"
                >
                  <span className="block text-sm text-neutral-base">
                    {formatDateTime(c, timezone).slice(-5)}
                  </span>
                  {end && (
                    <span className="block text-xs font-medium text-neutral-base/55">
                      ~{formatDateTime(end, timezone).slice(-5)}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {expertRows.map((row) => {
            const cells = byExpert.get(row.expertId);
            return (
              <tr key={row.expertId} className="border-b border-border last:border-b-0">
                <th className="sticky left-0 z-10 w-44 whitespace-nowrap border-r border-border bg-white px-3 py-2 text-left align-top">
                  <span className="inline-block rounded bg-neutral-base px-2 py-0.5 text-xs font-bold text-white">
                    {row.tableCode}
                  </span>
                  <span className="mt-1 block text-sm font-bold text-neutral-base">
                    {row.name}
                  </span>
                  {row.org && (
                    <span className="block text-xs font-medium text-neutral-base/70">
                      {row.org}
                    </span>
                  )}
                </th>
                {columns.map((c) => {
                  const slot = cells?.get(c);
                  return (
                    <td
                      key={c}
                      className="w-[150px] border-r border-border p-1 align-top last:border-r-0"
                    >
                      <GridCell
                        slot={slot}
                        userById={userById}
                        locked={locked}
                        pending={pending}
                        onMarkNoShow={onMarkNoShow}
                        onSetSessionStatus={onSetSessionStatus}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 한 칸: 진행 상태 배지 + 기업명/대표자명 + 진행 액션(대기/진행/완료/노쇼). 출석은 상태가 자동 처리. */
function GridCell({
  slot,
  userById,
  locked,
  pending,
  onMarkNoShow,
  onSetSessionStatus,
}: {
  slot: MatchingSlotRow | undefined;
  userById: Map<string, AssignableUser>;
  locked: boolean;
  pending: boolean;
  onMarkNoShow: (slot: MatchingSlotRow) => void;
  onSetSessionStatus: (slot: MatchingSlotRow, status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED') => void;
}) {
  if (!slot) return <span className="block text-center text-neutral-base/15">·</span>;
  if (!slot.startup_id) {
    return <span className="block py-2 text-center text-xs text-neutral-base/35">빈 슬롯</span>;
  }

  const startup = userById.get(slot.startup_id);
  const status = slot.session_status;
  // 노쇼는 대기/진행 상태에서만 설정 가능(mark_no_show 가드). 그 외는 대기/진행/완료로 되돌려서.
  const noShowSettable = status === 'WAITING' || status === 'IN_PROGRESS';

  return (
    <div className={`flex flex-col gap-1 rounded-md px-1 py-1.5 ${SESSION_CELL_TINT[slot.session_status]}`}>
      <div className="flex justify-center">
        <span
          className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[slot.session_status]}`}
        >
          {SESSION_STATUS_LABELS[slot.session_status]}
        </span>
      </div>

      <div className="text-center leading-tight">
        <p className="break-keep text-xs font-bold text-neutral-base">
          {startup ? companyName(startup) : '(알 수 없음)'}
        </p>
        {startup?.representative_name && (
          <p className="break-keep text-[10px] text-neutral-base/60">
            {startup.representative_name}
          </p>
        )}
      </div>

      {/* 진행 상태 직접 제어(대기/진행/완료/노쇼) — 2×2 동일 크기 버튼. 관리자가 자유 전환.
          출석은 별도 마킹 없이 상태 전환에 따라 백엔드가 자동 동기화한다(ideation §1). */}
      <div className="grid grid-cols-2 gap-1">
        <StatusButton
          label="대기"
          tone={SESSION_STATUS_TONE.WAITING}
          active={status === 'WAITING'}
          disabled={locked || pending}
          onClick={() => onSetSessionStatus(slot, 'WAITING')}
        />
        <StatusButton
          label="진행"
          tone={SESSION_STATUS_TONE.IN_PROGRESS}
          active={status === 'IN_PROGRESS'}
          disabled={locked || pending}
          onClick={() => onSetSessionStatus(slot, 'IN_PROGRESS')}
        />
        <StatusButton
          label="완료"
          tone={SESSION_STATUS_TONE.COMPLETED}
          active={status === 'COMPLETED'}
          disabled={locked || pending}
          onClick={() => onSetSessionStatus(slot, 'COMPLETED')}
        />
        <StatusButton
          label="노쇼"
          tone={SESSION_STATUS_TONE.NO_SHOW}
          active={status === 'NO_SHOW'}
          // 노쇼는 대기/진행에서만 새로 설정 가능(사유 모달). 완료/노쇼면 비활성.
          disabled={locked || pending || !noShowSettable}
          onClick={() => onMarkNoShow(slot)}
        />
      </div>
    </div>
  );
}

/** 진행 상태 2×2 그리드의 단일 버튼(활성=tone 채움, 비활성=흰색 outline). */
function StatusButton({
  label,
  tone,
  active,
  disabled,
  onClick,
}: {
  label: string;
  tone: Tone;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled || active}
      onClick={onClick}
      className={`rounded-md px-1 py-1 text-[10px] font-bold transition-colors disabled:cursor-default ${
        active
          ? SOLID_TONE[tone]
          : 'border border-border bg-surface-raised text-neutral-base/70 hover:bg-surface disabled:opacity-50'
      }`}
    >
      {label}
    </button>
  );
}

