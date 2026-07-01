import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { FieldTags } from '@/components/common/FieldTags';
import { TableTag } from '@/components/common/TableTag';
import { CompactTagButton } from '@/components/common/Tag';
import { buildBookingSchedule } from '@/lib/booking';
import { formatDateTime } from '@/lib/datetime';
import type { Tone } from '@/lib/tone';
import { companyName, SESSION_STATUS_LABELS, SESSION_STATUS_TONE } from '@/lib/labels';
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
  /** field_id → 분야명. 전문가 행 소속 아래 분야 태그 표시용. */
  fieldNameById: Map<string, string>;
  timezone: string;
  locked: boolean;
  /** 상태/노쇼 mutation 진행 중 — 셀 버튼 비활성. */
  pending: boolean;
  /** 노쇼 처리(사유 모달 오픈). */
  onMarkNoShow: (slot: MatchingSlotRow) => void;
  /** 진행 상태 직접 설정(대기중/진행중/완료, 관리/스태프). 출석은 상태 전환에 따라 자동 동기화된다. */
  onSetSessionStatus: (
    slot: MatchingSlotRow,
    status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED',
  ) => void;
  /** 노쇼 슬롯에 현장 대기 스타트업 대체 매칭(모달 오픈, ideation §2). */
  onReplaceNoShow: (slot: MatchingSlotRow) => void;
  /** 스타트업(company_user_id)별 등록된 증빙사진 수 — 셀 📷 배지/필터 (ideation §3). */
  photoCountByStartup: Map<string, number>;
  /** "사진 미등록 셀만 보기" — 켜면 사진 있는 셀을 흐리게, 미등록 셀을 강조한다. */
  photoFilter: boolean;
  /** 셀 📷 버튼 클릭 → 해당 스타트업 증빙사진 업로드/검수 모달 오픈. */
  onOpenPhotos: (slot: MatchingSlotRow) => void;
  /** 셀 기업 정보 클릭 → 상담 신청 상세(희망사항·첨부·링크) 모달 오픈. */
  onOpenDetail: (slot: MatchingSlotRow) => void;
  /** 담당자 이름 해석용 오퍼레이터 목록(user_id → 이름). 배정은 테이블 설정에서 한다. */
  operators: TableManagerOption[];
  /** table_id → 현재 담당자 user_id(없으면 null). 1열 담당자 이름 표시용(읽기전용). */
  managerByTable: Map<string, string | null>;
  /** 크게보기: 표를 가로 전체로 늘려 화면을 꽉 채운다(열이 남은 폭을 나눠 갖는다). */
  fillWidth?: boolean;
  /** 전문가·기업·대표자·테이블 키워드 검색어. */
  search?: string;
}

/** 1열 담당자 셀렉트 옵션(행사 배정 오퍼레이터). */
export interface TableManagerOption {
  userId: string;
  name: string;
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

function includesSearch(text: string, search: string): boolean {
  const q = search.trim().toLowerCase();
  return q.length > 0 && text.toLowerCase().includes(q);
}

interface ExpertRow {
  expertId: string;
  name: string;
  org: string | null;
  fields: string[];
  tableCode: string;
  /** 이 전문가의 기본 테이블 id. 담당자 배정 대상(없으면 null=배정 불가). */
  tableId: string | null;
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
  fieldNameById,
  timezone,
  locked,
  pending,
  onMarkNoShow,
  onSetSessionStatus,
  onReplaceNoShow,
  photoCountByStartup,
  photoFilter,
  onOpenPhotos,
  onOpenDetail,
  operators,
  managerByTable,
  fillWidth = false,
  search = '',
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

  // 현재 진행 중인 시간대 열을 강조(진한 테두리)하기 위한 시계. 1분마다 갱신.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** now 가 [start, end) 안에 드는 열의 start_time(없으면 null). 셀 테두리 강조용. */
  const currentColumn = useMemo(() => {
    for (const c of columns) {
      const start = new Date(c).getTime();
      const end = endByStart.get(c);
      const endMs = end ? new Date(end).getTime() : start + 50 * 60 * 1000;
      if (now >= start && now < endMs) return c;
    }
    return null;
  }, [columns, endByStart, now]);

  const tableCodeById = useMemo(() => new Map(tables.map((t) => [t.id, t.table_code])), [tables]);
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
        fields: (u?.field_ids ?? [])
          .map((id) => fieldNameById.get(id))
          .filter((v): v is string => Boolean(v)),
        tableCode: tid ? (tableCodeById.get(tid) ?? '미지정') : '미지정',
        tableId: tid,
      };
    });
    return rows.sort(
      (a, b) => a.tableCode.localeCompare(b.tableCode, 'ko') || a.name.localeCompare(b.name, 'ko'),
    );
  }, [byExpert, userById, fieldNameById, defaultTableByExpert, tableCodeById]);

  const visibleExpertRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return expertRows;

    return expertRows.filter((row) => {
      const cells = byExpert.get(row.expertId);
      const startupText = [...(cells?.values() ?? [])]
        .map((slot) => {
          const startup = slot.startup_id ? userById.get(slot.startup_id) : undefined;
          return [
            startup ? companyName(startup) : '',
            startup?.representative_name ?? '',
            startup?.phone_number ?? '',
            SESSION_STATUS_LABELS[slot.session_status],
          ].join(' ');
        })
        .join(' ');

      return [row.tableCode, row.name, row.org ?? '', row.fields.join(' '), startupText]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [search, expertRows, byExpert, userById]);

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
        아직 생성된 슬롯이 없습니다. 배치 단계에서 시간표 슬롯을 생성하면 진행 현황이 표시됩니다.
      </p>
    );
  }

  if (visibleExpertRows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
        검색 조건에 맞는 진행 세션이 없습니다.
      </p>
    );
  }

  return (
    // 바깥: 둥근 모서리·테두리·overflow-hidden 으로 모양을 잡아 스크롤바가 모서리를 사각으로 덮지 않게 한다.
    // fillWidth(크게보기): 스크롤 영역을 화면 폭·높이로 넓힌다. 셀 크기는 그대로 두고,
    //   내용이 넓으면 가로 스크롤되게 한다(표 자체를 늘리지 않는다).
    <div
      className={`overflow-hidden rounded-xl border border-border ${
        fillWidth ? 'w-full flex-1 min-h-0' : 'w-fit max-w-full'
      }`}
    >
      {/* 안쪽: 실제 가로·세로 스크롤 담당. fillWidth 면 부모(카드) 남은 높이를 h-full 로 꽉 채우고,
          표보다 넓은 남는 영역은 회색(bg-surface)으로 채운다(표 자체는 흰색 bg-surface-raised). */}
      <div className={`overflow-auto ${fillWidth ? 'h-full bg-surface' : 'max-h-[calc(100vh-220px)]'}`}>
        <table className={`border-collapse text-left text-sm ${fillWidth ? 'bg-surface-raised' : ''}`}>
          <thead>
            <tr className="sticky top-0 z-20 border-b-2 border-border bg-surface text-neutral-base">
              <th className="sticky left-0 z-30 w-44 min-w-44 whitespace-nowrap border-r border-border bg-surface px-3 py-2.5 font-bold">
                테이블 · 전문가
              </th>
              {columns.map((c) => {
                const end = endByStart.get(c);
                const isCurrent = c === currentColumn;
                return (
                  <th
                    key={c}
                    className={`w-[150px] min-w-[150px] whitespace-nowrap bg-surface px-1 py-2 text-center font-bold ${
                      isCurrent
                        ? 'border-x-2 border-t-2 border-brand'
                        : 'border-r border-border last:border-r-0'
                    }`}
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
            {visibleExpertRows.map((row, rowIdx) => {
              const cells = byExpert.get(row.expertId);
              const isLastRow = rowIdx === visibleExpertRows.length - 1;
              const rowSearchMatched = includesSearch(
                [row.tableCode, row.name, row.org ?? '', row.fields.join(' ')].join(' '),
                search,
              );
              return (
                <tr key={row.expertId} className="border-b border-border last:border-b-0">
                  <th
                    className={`sticky left-0 z-10 w-56 min-w-56 whitespace-nowrap border-r border-border bg-white px-3 py-2 text-left align-middle ${
                      rowSearchMatched ? 'ring-2 ring-inset ring-brand' : ''
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <TableTag code={row.tableCode} />
                      <span className="text-sm font-bold text-neutral-base">{row.name}</span>
                    </span>
                    {row.org && (
                      <span className="mt-0.5 block text-xs font-medium text-neutral-base/70">
                        {row.org}
                      </span>
                    )}
                    <FieldTags names={row.fields} className="mt-1" />
                    {/* 테이블 현장 담당자(오퍼레이터) — 1열 하단 읽기전용 표시. 배정은 테이블 설정에서. */}
                    <TableManagerField
                      tableId={row.tableId}
                      managerId={row.tableId ? (managerByTable.get(row.tableId) ?? null) : null}
                      operators={operators}
                    />
                  </th>
                  {columns.map((c) => {
                    const slot = cells?.get(c);
                    // 빈 칸/빈 슬롯은 셀 세로 가운데 정렬, 예약된 칸은 위 정렬.
                    const isEmpty = !slot || !slot.startup_id;
                    const isCurrent = c === currentColumn;
                    return (
                      <td
                        key={c}
                        className={`w-[150px] min-w-[150px] p-1 ${
                          isEmpty ? 'align-middle' : 'align-top'
                        } ${
                          isCurrent
                            ? `border-x-2 border-brand ${isLastRow ? 'border-b-2' : ''}`
                            : 'border-r border-border last:border-r-0'
                        }`}
                      >
                        <GridCell
                          slot={slot}
                          userById={userById}
                          locked={locked}
                          pending={pending}
                          photoCount={
                            slot?.startup_id ? (photoCountByStartup.get(slot.startup_id) ?? 0) : 0
                          }
                          photoFilter={photoFilter}
                          onMarkNoShow={onMarkNoShow}
                          onSetSessionStatus={onSetSessionStatus}
                          onReplaceNoShow={onReplaceNoShow}
                          onOpenPhotos={onOpenPhotos}
                          onOpenDetail={onOpenDetail}
                          search={search}
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
    </div>
  );
}

/**
 * 1열(테이블·전문가) 하단 현장 담당자 읽기전용 표시.
 * 담당자 배정은 테이블 설정(EventTablesPanel)에서 하고, 진행 현황에서는 이름만 보여준다.
 * - 테이블 미지정(전문가에 기본 테이블 없음): 안내 문구.
 * - 그 외: 현재 담당자 이름(미지정이면 '미지정').
 */
function TableManagerField({
  tableId,
  managerId,
  operators,
}: {
  tableId: string | null;
  managerId: string | null;
  operators: TableManagerOption[];
}) {
  if (!tableId) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-left text-xs font-medium text-neutral-base/40">
        담당자: 테이블 미지정
      </p>
    );
  }

  const managerName = managerId
    ? (operators.find((o) => o.userId === managerId)?.name ?? '(배정 외 담당자)')
    : null;

  return (
    <div className="mt-3 border-t border-border pt-3 text-left">
      <span className="mb-0.5 block text-xs font-semibold text-neutral-base/55">현장 담당자</span>
      <span className="block text-sm font-bold text-neutral-base/80">{managerName ?? '미지정'}</span>
    </div>
  );
}

/** 한 칸: 진행 상태 배지 + 기업명/대표자명 + 진행 액션(대기/진행/완료/노쇼) + 증빙사진. 출석은 상태가 자동 처리. */
function GridCell({
  slot,
  userById,
  locked,
  pending,
  photoCount,
  photoFilter,
  onMarkNoShow,
  onSetSessionStatus,
  onReplaceNoShow,
  onOpenPhotos,
  onOpenDetail,
  search,
}: {
  slot: MatchingSlotRow | undefined;
  userById: Map<string, AssignableUser>;
  locked: boolean;
  pending: boolean;
  photoCount: number;
  photoFilter: boolean;
  onMarkNoShow: (slot: MatchingSlotRow) => void;
  onSetSessionStatus: (
    slot: MatchingSlotRow,
    status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED',
  ) => void;
  onReplaceNoShow: (slot: MatchingSlotRow) => void;
  onOpenPhotos: (slot: MatchingSlotRow) => void;
  onOpenDetail: (slot: MatchingSlotRow) => void;
  search: string;
}) {
  // 사진 필터 켜짐: 사진과 무관한 칸(빈 칸/빈 슬롯)은 흐리게 처리해 미등록 셀을 부각한다.
  if (!slot) {
    return (
      <span className={`block text-center text-neutral-base/15 ${photoFilter ? 'opacity-25' : ''}`}>
        ·
      </span>
    );
  }
  if (!slot.startup_id) {
    return (
      <span
        className={`block text-center text-xs text-neutral-base/35 ${photoFilter ? 'opacity-25' : ''}`}
      >
        빈 슬롯
      </span>
    );
  }

  const startup = userById.get(slot.startup_id);
  const status = slot.session_status;
  // 노쇼는 대기/진행 상태에서만 설정 가능(mark_no_show 가드). 그 외는 대기/진행/완료로 되돌려서.
  const noShowSettable = status === 'WAITING' || status === 'IN_PROGRESS';
  // 사진 필터(ideation §3): 미등록 셀은 ring 강조, 등록 완료 셀은 흐리게.
  const needsPhoto = photoFilter && photoCount === 0;
  const dimmed = photoFilter && photoCount > 0;
  const searchMatched = includesSearch(
    [
      startup ? companyName(startup) : '',
      startup?.representative_name ?? '',
      startup?.phone_number ?? '',
      SESSION_STATUS_LABELS[slot.session_status],
    ].join(' '),
    search,
  );

  return (
    <div
      className={`flex flex-col gap-1 rounded-md px-1 py-1.5 transition-opacity ${SESSION_CELL_TINT[slot.session_status]} ${
        dimmed ? 'opacity-25' : ''
      } ${searchMatched ? 'ring-2 ring-brand' : needsPhoto ? 'ring-2 ring-[#000000]' : ''}`}
    >
      <div className="flex justify-center">
        <Badge
          tone={SESSION_STATUS_TONE[slot.session_status]}
          size="11"
          className={slot.session_status === 'CANCELLED' ? 'line-through' : ''}
        >
          {SESSION_STATUS_LABELS[slot.session_status]}
        </Badge>
      </div>

      {/* 기업 정보 클릭 → 상담 신청 상세(희망사항·첨부·링크) 모달. */}
      <button
        type="button"
        onClick={() => onOpenDetail(slot)}
        title="상담 신청 상세 보기"
        className="rounded-md border border-transparent px-1 py-0.5 text-center leading-tight outline-none transition-colors hover:border-brand hover:bg-danger-surface focus-visible:ring-2 focus-visible:ring-brand"
      >
        <p className="break-keep text-xs font-bold text-neutral-base">
          {startup ? companyName(startup) : '(알 수 없음)'}
        </p>
        {startup?.representative_name && (
          <p className="break-keep text-xs text-neutral-base">{startup.representative_name}</p>
        )}
        {startup?.phone_number && (
          <p className="break-keep text-[11px] text-neutral-base/70">{startup.phone_number}</p>
        )}
      </button>

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

      {/* 노쇼 현장 대체 매칭(ideation §2): 노쇼 슬롯을 재사용해 현장 대기 스타트업을 새로 배정. */}
      {status === 'NO_SHOW' && (
        <CompactTagButton
          tone="danger"
          type="button"
          disabled={locked || pending}
          onClick={() => onReplaceNoShow(slot)}
          className="hover:brightness-95 disabled:opacity-50"
        >
          현장 대체 매칭
        </CompactTagButton>
      )}

      {/* 증빙사진 통합(ideation §3): 셀에서 바로 업로드/검수 모달을 연다. 사진은 (행사×스타트업) 단위.
          노쇼 셀은 증빙 대상이 아니므로 사진 버튼을 숨긴다. */}
      {status !== 'NO_SHOW' && (
        <PhotoCellButton count={photoCount} onClick={() => onOpenPhotos(slot)} />
      )}
    </div>
  );
}

/** 셀 하단 증빙사진 버튼 — 등록 수 배지(있음=success, 없음=점선). 클릭 시 사진 모달. */
function PhotoCellButton({ count, onClick }: { count: number; onClick: () => void }) {
  const has = count > 0;
  return (
    <CompactTagButton
      type="button"
      onClick={onClick}
      aria-label={has ? `증빙사진 ${count}장 보기` : '증빙사진 등록'}
      tone={has ? 'success' : 'muted'}
      className={`gap-1 ${has ? 'hover:brightness-95' : 'border-dashed text-neutral-base/55'}`}
    >
      <CameraIcon />
      <span>{has ? `${count}장` : '사진 등록'}</span>
    </CompactTagButton>
  );
}

/** 미니 카메라 아이콘(12px). */
function CameraIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 6.5h2.2l1-1.6h5.6l1 1.6H17a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="11" r="2.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** 진행 상태 2×2 그리드의 단일 버튼(활성=태그 tone 칩+ring, 비활성=흰색 outline). */
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
    <CompactTagButton
      type="button"
      active={active}
      tone={tone}
      disabled={disabled || active}
      onClick={onClick}
    >
      {label}
    </CompactTagButton>
  );
}
