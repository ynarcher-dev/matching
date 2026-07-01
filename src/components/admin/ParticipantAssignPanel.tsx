/* eslint-disable max-lines */
import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { SectionActionButton } from '@/components/common/ActionButton';
import { Modal } from '@/components/common/Modal';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { SelectBox } from '@/components/common/SelectBox';
import { StatBox } from '@/components/common/StatBox';
import { StatCardSection } from '@/components/common/StatCardSection';
import { FilterBar, FilterChips, SearchInput } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { Tabs } from '@/components/common/Tabs';
import { ParticipantDetailModal } from '@/components/admin/ParticipantDetailModal';
import { EmergencyLinkModal } from '@/components/admin/EmergencyLinkModal';
import { UserDetailModal, type EditableParticipant } from '@/components/admin/UserDetailModal';
import {
  FileCell,
  FieldsCell,
  ProposalStatusCell,
  RowAction,
} from '@/components/admin/participantCells';
import { formatDateTime } from '@/lib/datetime';
import { toCsv } from '@/lib/surveyReport';
import { useDataTable } from '@/hooks/useDataTable';
import { useFields } from '@/hooks/useFields';
import { useEventSlots } from '@/hooks/useEventDetail';
import {
  useAddParticipants,
  useRemoveParticipant,
  useRemoveParticipants,
} from '@/hooks/useEventDetailMutations';
import { useInvalidateSessions } from '@/hooks/useUserMutations';
import { toast } from '@/stores/toastStore';
import { PARTICIPANT_ROLE_LABELS } from '@/lib/labels';
import type { SortValue } from '@/lib/dataTable';
import type { AssignableUser, EventParticipantRow, EventTable } from '@/types/eventDetail';
import type { ParticipantRole } from '@/types/user';

/** 빈 값은 '-' 로(표 셀 공통). */
const dash = (v: string | null | undefined) => (v && v.length > 0 ? v : '-');

/** 관리자 표시 기준 타임존(스타트업 DB 와 동일하게 KST 기준). */
const DISPLAY_TZ = 'Asia/Seoul';

type FileFilter = 'ALL' | 'WITH' | 'WITHOUT';
type LoginFilter = 'ALL' | 'IN' | 'NONE';

/** 검색 대상 텍스트(이름·기업/소속·대표/직책·이메일·연락처). 명단/후보 모달 공통. */
function assignableSearchText(u: AssignableUser | null): string {
  if (!u) return '';
  return [
    u.name,
    u.company_name,
    u.representative_name,
    u.expert_organization,
    u.expert_position,
    u.email,
    u.phone_number,
  ]
    .filter(Boolean)
    .join(' ');
}

function toEditableParticipant(u: AssignableUser): EditableParticipant {
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    email: u.email ?? '',
    phone_number: u.phone_number,
    company_name: u.company_name,
    representative_name: u.representative_name,
    contact_name: u.contact_name,
    company_homepage: u.company_homepage,
    company_description: u.company_description,
    expert_organization: u.expert_organization,
    expert_position: u.expert_position,
    expert_description: u.expert_description,
    proposal_file_url: u.proposal_file_url,
    profile_image_url: u.profile_image_url,
    field_ids: u.field_ids,
  };
}

interface ParticipantAssignPanelProps {
  eventId: string;
  participants: EventParticipantRow[];
  assignableUsers: AssignableUser[];
  tables: EventTable[];
  /** 취소 행사 등 잠금 상태에서는 편집 불가. */
  locked: boolean;
  /**
   * 역할 고정 모드 (8-E 탭 분리). 지정 시 내부 서브탭을 숨기고 해당 역할만 다룬다.
   * 미지정이면 기존처럼 스타트업/전문가 서브탭을 노출한다.
   */
  lockedRole?: ParticipantRole;
}

/**
 * 참가자 지정(DRAFT) 패널 (page_admin_event_detail.md §2.1).
 * 전문가/스타트업 서브탭 + 미지정 후보 선택 추가 + 현재 명단(전문가 기본 테이블 지정·제외).
 * lockedRole 지정 시 단일 역할 전용 패널로 동작한다(`참가 스타트업`·`참가 전문가` 탭).
 */
export function ParticipantAssignPanel({
  eventId,
  participants,
  assignableUsers,
  tables,
  locked,
  lockedRole,
}: ParticipantAssignPanelProps) {
  const [innerRole, setInnerRole] = useState<ParticipantRole>('STARTUP');
  const role = lockedRole ?? innerRole;
  const [detailTarget, setDetailTarget] = useState<AssignableUser | null>(null);

  const tabOptions = useMemo(() => {
    return (['STARTUP', 'EXPERT'] as const).map((r) => ({
      value: r,
      label: PARTICIPANT_ROLE_LABELS[r],
      count: participants.filter((p) => p.participant_type === r).length,
    }));
  }, [participants]);

  const { data: fields } = useFields();
  const fieldNameById = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f.name])), [fields]);

  const userById = useMemo(() => new Map(assignableUsers.map((u) => [u.id, u])), [assignableUsers]);

  const current = useMemo(
    () => participants.filter((p) => p.participant_type === role),
    [participants, role],
  );
  const assignedIds = useMemo(() => new Set(participants.map((p) => p.user_id)), [participants]);
  const candidates = useMemo(
    () => assignableUsers.filter((u) => u.role === role && !assignedIds.has(u.id)),
    [assignableUsers, role, assignedIds],
  );

  const isExpert = role === 'EXPERT';
  const roleLabel = PARTICIPANT_ROLE_LABELS[role];

  // 통계 카드 섹션(다른 탭과 동일한 StatCardSection 레이아웃) — 참가 규모 + 준비/로그인 현황.
  const stats = useMemo(() => {
    const total = current.length;
    let loggedIn = 0;
    let withProposal = 0;
    let withFields = 0;
    for (const p of current) {
      const u = userById.get(p.user_id);
      if (!u) continue;
      if (u.last_login_at) loggedIn += 1;
      if (u.proposal_file_url) withProposal += 1;
      if ((u.field_ids?.length ?? 0) > 0) withFields += 1;
    }
    return { total, loggedIn, notLoggedIn: total - loggedIn, withProposal, withFields };
  }, [current, userById]);
  const unit = isExpert ? '명' : '개사';

  return (
    <div className="flex flex-col gap-4">
      <StatCardSection
        title={`참가 ${roleLabel} 현황`}
        description={
          isExpert
            ? '행사에 지정된 전문가의 분야 지정·로그인 현황을 집계합니다.'
            : '행사에 지정된 스타트업의 소개서 제출·로그인 현황을 집계합니다.'
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label={`참가 ${roleLabel}`} value={stats.total} hint={unit} />
          {isExpert ? (
            <StatBox label="분야 지정" value={stats.withFields} hint={unit} />
          ) : (
            <StatBox label="소개서 제출" value={stats.withProposal} hint={unit} />
          )}
          <StatBox label="로그인 완료" value={stats.loggedIn} hint={unit} />
          <StatBox label="미로그인" value={stats.notLoggedIn} hint={unit} />
        </div>
      </StatCardSection>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-neutral-base">
            {lockedRole ? `참가 ${PARTICIPANT_ROLE_LABELS[lockedRole]} 지정` : '참가자 지정'}
          </h2>
          {!lockedRole && <Tabs value={role} options={tabOptions} onChange={setInnerRole} />}
        </div>

        <CurrentList
          eventId={eventId}
          role={role}
          participants={current}
          userById={userById}
          tables={tables}
          locked={locked}
          fieldNameById={fieldNameById}
          onOpenDetail={setDetailTarget}
          addSlot={
            !locked ? (
              <AddCandidates
                eventId={eventId}
                role={role}
                candidates={candidates}
                fieldNameById={fieldNameById}
              />
            ) : null
          }
        />

        <ParticipantDetailModal
          open={detailTarget !== null}
          onClose={() => setDetailTarget(null)}
          user={detailTarget}
          fieldNameById={fieldNameById}
        />
      </Card>
    </div>
  );
}

/** 후보 추가 진입: 별도 버튼 → 모달(검색 + 복수 체크 + 일괄 추가). */
function AddCandidates({
  eventId,
  role,
  candidates,
  fieldNameById,
}: {
  eventId: string;
  role: ParticipantRole;
  candidates: AssignableUser[];
  fieldNameById: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SectionActionButton tone="primary" onClick={() => setOpen(true)}>
        + {PARTICIPANT_ROLE_LABELS[role]} 추가
      </SectionActionButton>
      <AddCandidatesModal
        open={open}
        onClose={() => setOpen(false)}
        eventId={eventId}
        role={role}
        candidates={candidates}
        fieldNameById={fieldNameById}
      />
    </>
  );
}

/**
 * 후보 다중 선택 모달.
 * 스타트업 DB 와 동일한 공통 표(DataTable)·셀(FieldsCell·FileCell)을 재활용해
 * 기업명/대표자·이메일·연락처·분야·소개·IR/소개서 자료를 그대로 보여준다.
 * IR/소개서는 업로드/미업로드로 표시하고, 업로드 건은 '보기'로 자료를 새 탭에서 연다.
 * 행(또는 좌측 체크박스) 클릭으로 선택, 검색·정렬·30 페이지네이션 후 일괄 등록.
 */
function AddCandidatesModal({
  open,
  onClose,
  eventId,
  role,
  candidates,
  fieldNameById,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  role: ParticipantRole;
  candidates: AssignableUser[];
  fieldNameById: Map<string, string>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const add = useAddParticipants(eventId);
  const isExpert = role === 'EXPERT';

  const primaryOf = (u: AssignableUser) => (isExpert ? u.name : (u.company_name ?? u.name)) ?? '';
  const sortValues = useMemo<Record<string, (row: AssignableUser) => SortValue>>(
    () => ({ primary: primaryOf }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isExpert],
  );

  const table = useDataTable(candidates, {
    getSearchText: assignableSearchText,
    sortValues,
    initialSort: { key: 'primary', direction: 'asc' },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 현재 페이지 행 기준 전체 선택/해제(명단 표와 동일한 규약).
  const pageRows = table.rows;
  const allPageSelected = pageRows.length > 0 && pageRows.every((u) => selected.has(u.id));
  const toggleAllPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageRows.forEach((u) => next.delete(u.id));
      else pageRows.forEach((u) => next.add(u.id));
      return next;
    });

  const close = () => {
    setSelected(new Set());
    table.setSearch('');
    onClose();
  };

  const submit = () => {
    const count = selected.size;
    add.mutate(
      { userIds: [...selected], type: role },
      {
        onSuccess: () => {
          close();
          toast.success(`${count}명을 배정했습니다.`);
        },
        onError: (e) =>
          toast.error('참가자를 배정하지 못했습니다.', { description: (e as Error).message }),
      },
    );
  };

  const columns = useMemo<DataTableColumn<AssignableUser>[]>(() => {
    const cols: DataTableColumn<AssignableUser>[] = [
      {
        key: 'select',
        header: (
          <button
            type="button"
            onClick={toggleAllPage}
            aria-pressed={allPageSelected}
            aria-label="현재 페이지 전체 선택"
            className="inline-flex items-center"
          >
            <SelectBox checked={allPageSelected} />
          </button>
        ),
        align: 'center',
        className: 'w-10',
        cell: (u) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle(u.id);
            }}
            aria-pressed={selected.has(u.id)}
            aria-label="선택"
            className="inline-flex items-center"
          >
            <SelectBox checked={selected.has(u.id)} />
          </button>
        ),
      },
    ];

    if (isExpert) {
      cols.push(
        {
          key: 'primary',
          header: '이름',
          sortable: true,
          cell: (u) => <span className="font-medium text-neutral-base">{dash(u.name)}</span>,
        },
        { key: 'org', header: '소속', cell: (u) => dash(u.expert_organization) },
        { key: 'position', header: '직책', cell: (u) => dash(u.expert_position) },
        {
          key: 'email',
          header: '이메일',
          cell: (u) => <span className="text-neutral-base/80">{dash(u.email)}</span>,
        },
        { key: 'phone', header: '연락처', cell: (u) => dash(u.phone_number) },
      );
    } else {
      cols.push(
        {
          key: 'primary',
          header: '기업명',
          sortable: true,
          cell: (u) => (
            <span className="font-medium text-neutral-base">{dash(u.company_name)}</span>
          ),
        },
        { key: 'rep', header: '대표자명', cell: (u) => dash(u.representative_name) },
        {
          key: 'email',
          header: '이메일',
          cell: (u) => <span className="text-neutral-base/80">{dash(u.email)}</span>,
        },
        { key: 'phone', header: '연락처', cell: (u) => dash(u.phone_number) },
      );
    }

    cols.push({
      key: 'fields',
      header: '분야',
      cell: (u) => <FieldsCell ids={u.field_ids} nameById={fieldNameById} />,
    });

    // IR/소개서 자료(스타트업): 스타트업 DB 와 동일하게 업로드/미업로드 + '보기'.
    // 셀 클릭이 행 선택을 토글하지 않도록 stopPropagation.
    if (!isExpert) {
      cols.push({
        key: 'ir',
        header: 'IR/소개서',
        align: 'right',
        cell: (u) => (
          <span onClick={(e) => e.stopPropagation()}>
            {u.proposal_file_url ? (
              <FileCell path={u.proposal_file_url} label="보기" />
            ) : (
              <Badge tone="danger">미업로드</Badge>
            )}
          </span>
        ),
      });
    }

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpert, fieldNameById, selected, allPageSelected, pageRows]);

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      title={`${PARTICIPANT_ROLE_LABELS[role]} 추가`}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            취소
          </Button>
          <Button onClick={submit} loading={add.isPending} disabled={selected.size === 0}>
            선택 {selected.size}명 추가
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-base/60">
            추가할 수 있는 후보가 없습니다.
          </p>
        ) : (
          <>
            <FilterBar>
              <SearchInput
                value={table.search}
                onChange={table.setSearch}
                placeholder={`${PARTICIPANT_ROLE_LABELS[role]} 이름·기업/소속·이메일·연락처 검색`}
              />
            </FilterBar>
            <div className="flex justify-end text-xs text-neutral-base/60">
              선택 {selected.size}명 · 후보 {table.totalFiltered}명
            </div>
            <DataTable
              columns={columns}
              rows={table.rows}
              rowKey={(u) => u.id}
              sort={table.sort}
              onSort={table.toggleSort}
              onRowClick={(u) => toggle(u.id)}
              minWidthClass="min-w-[860px]"
              emptyMessage="검색 조건에 맞는 후보가 없습니다."
            />
            <Pagination
              page={table.page}
              totalPages={table.totalPages}
              pageSize={table.pageSize}
              total={table.totalFiltered}
              onPageChange={table.setPage}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * 현재 참가 명단 (8-J: 8-C 공통 DataTable 로 전환 — 검색·정렬·30 페이지네이션).
 * 전문가는 기본 테이블 인라인 셀렉트, 공통 제외 버튼을 셀 안에 유지한다.
 */
function CurrentList({
  eventId,
  role,
  participants,
  userById,
  tables,
  locked,
  fieldNameById,
  onOpenDetail,
  addSlot,
}: {
  eventId: string;
  role: ParticipantRole;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  tables: EventTable[];
  locked: boolean;
  fieldNameById: Map<string, string>;
  onOpenDetail: (user: AssignableUser) => void;
  /** 검색줄 우측에 함께 배치할 '추가' 버튼(잠금 시 null). */
  addSlot?: ReactNode;
}) {
  const remove = useRemoveParticipant(eventId);
  const removeMany = useRemoveParticipants(eventId);
  const invalidate = useInvalidateSessions();
  const isExpert = role === 'EXPERT';
  const [editTarget, setEditTarget] = useState<AssignableUser | null>(null);
  const [invalidateTarget, setInvalidateTarget] = useState<AssignableUser | null>(null);
  const [linkTarget, setLinkTarget] = useState<AssignableUser | null>(null);
  const [fileFilter, setFileFilter] = useState<FileFilter>('ALL');
  const [loginFilter, setLoginFilter] = useState<LoginFilter>('ALL');

  // 제외 시 함께 취소될 배치(슬롯) 건수 — 참가자 user_id 별 활성(취소 제외) 세션 수.
  const { data: slots } = useEventSlots(eventId);
  const bookingCountByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots ?? []) {
      if (s.session_status === 'CANCELLED') continue;
      const uid = isExpert ? s.expert_id : s.startup_id;
      if (uid) m.set(uid, (m.get(uid) ?? 0) + 1);
    }
    return m;
  }, [slots, isExpert]);

  // 전문가 기본 테이블은 '테이블 세팅' 탭(행사장 테이블)에서 지정하고, 여기선 읽기 전용 표시.
  const tableCodeById = useMemo(() => new Map(tables.map((t) => [t.id, t.table_code])), [tables]);

  // 복수 선택(제외용). 명단에서 사라진 항목은 selectedIds 계산 시 걸러낸다.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelected = () => setSelected(new Set());

  const userOf = (p: EventParticipantRow) => userById.get(p.user_id) ?? null;
  const searchTextOf = (p: EventParticipantRow) => {
    const u = userOf(p);
    if (!u) return '';
    return [
      u.name,
      u.company_name,
      u.representative_name,
      u.expert_organization,
      u.expert_position,
      u.email,
      u.phone_number,
    ]
      .filter(Boolean)
      .join(' ');
  };

  // 정렬 가능 컬럼(스타트업 DB 와 동일): 이름·기업/소속·최근 로그인·등록일.
  const sortValues = useMemo<Record<string, (row: EventParticipantRow) => SortValue>>(
    () => ({
      name: (p) => userOf(p)?.name ?? '',
      company: (p) => (isExpert ? userOf(p)?.expert_organization : userOf(p)?.company_name) ?? '',
      last_login: (p) => userOf(p)?.last_login_at ?? null,
      created_at: (p) => userOf(p)?.created_at ?? null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userById, isExpert],
  );

  const filters = useMemo(() => {
    const preds: Array<(p: EventParticipantRow) => boolean> = [];
    if (!isExpert) {
      if (fileFilter === 'WITH') preds.push((p) => Boolean(userOf(p)?.proposal_file_url));
      else if (fileFilter === 'WITHOUT') preds.push((p) => !userOf(p)?.proposal_file_url);
    }
    if (loginFilter === 'IN') preds.push((p) => Boolean(userOf(p)?.last_login_at));
    else if (loginFilter === 'NONE') preds.push((p) => !userOf(p)?.last_login_at);
    return preds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpert, fileFilter, loginFilter, userById]);

  const table = useDataTable(participants, {
    getSearchText: searchTextOf,
    sortValues,
    filters,
    initialSort: { key: 'name', direction: 'asc' },
  });

  // 현재 페이지 행 기준 전체 선택/해제.
  const pageRows = table.rows;
  const allPageSelected = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));
  const toggleAllPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageRows.forEach((p) => next.delete(p.id));
      else pageRows.forEach((p) => next.add(p.id));
      return next;
    });

  // 실제 명단에 존재하는 선택 항목만 제외 대상으로 삼는다.
  const participantIds = useMemo(() => new Set(participants.map((p) => p.id)), [participants]);
  const selectedIds = useMemo(
    () => [...selected].filter((id) => participantIds.has(id)),
    [selected, participantIds],
  );
  // 제외 확인 모달 대상. 배치(슬롯)가 있는 참가자를 제외하면 그 배치가 모두 취소되므로,
  // 건수가 있을 때만 경고 모달을 거친다(0056 정책: 제외 → 슬롯 CANCELLED).
  const [confirmTarget, setConfirmTarget] = useState<
    { kind: 'single'; participant: EventParticipantRow } | { kind: 'bulk'; ids: string[] } | null
  >(null);

  const userIdByParticipantId = useMemo(
    () => new Map(participants.map((p) => [p.id, p.user_id])),
    [participants],
  );

  // 개별 제외 — 배치가 있으면 확인을 받고, 없으면 즉시 제외.
  const requestRemove = (p: EventParticipantRow) => {
    if ((bookingCountByUser.get(p.user_id) ?? 0) > 0) {
      setConfirmTarget({ kind: 'single', participant: p });
    } else {
      remove.mutate(p.id);
    }
  };

  // 선택 제외 — 선택 항목 중 배치가 있는 참가자가 하나라도 있으면 확인을 받는다.
  const requestBulkRemove = () => {
    if (selectedIds.length === 0) return;
    const hasBookings = selectedIds.some((id) => {
      const uid = userIdByParticipantId.get(id);
      return uid ? (bookingCountByUser.get(uid) ?? 0) > 0 : false;
    });
    if (hasBookings) setConfirmTarget({ kind: 'bulk', ids: selectedIds });
    else
      removeMany.mutate(selectedIds, {
        onSuccess: () => {
          clearSelected();
          toast.success('선택한 참가자를 제외했습니다.');
        },
        onError: (e) =>
          toast.error('참가자를 제외하지 못했습니다.', { description: (e as Error).message }),
      });
  };

  const handleConfirmRemove = () => {
    if (!confirmTarget) return;
    if (confirmTarget.kind === 'single') {
      remove.mutate(confirmTarget.participant.id, {
        onSuccess: () => {
          setConfirmTarget(null);
          toast.success('참가자를 제외했습니다.');
        },
        onError: (e) =>
          toast.error('참가자를 제외하지 못했습니다.', { description: (e as Error).message }),
      });
    } else {
      removeMany.mutate(confirmTarget.ids, {
        onSuccess: () => {
          clearSelected();
          setConfirmTarget(null);
          toast.success('선택한 참가자를 제외했습니다.');
        },
        onError: (e) =>
          toast.error('참가자를 제외하지 못했습니다.', { description: (e as Error).message }),
      });
    }
  };

  // 상단이 가장 큰 번호가 되도록 검색·필터 적용 후 전체 기준 역순 번호(스타트업 DB 와 동일).
  const getRowNumber = (indexOnPage: number) =>
    table.totalFiltered - ((table.page - 1) * table.pageSize + indexOnPage);

  // 전체 명단 CSV 내보내기 — 검색·필터·페이지와 무관하게 이 역할의 전 참가자를 이름순으로.
  const handleExportCsv = () => {
    const headers = isExpert
      ? ['이름', '소속', '직책', '이메일', '연락처', '분야', '배정 테이블', '최근 로그인', '등록일']
      : [
          '이름',
          '기업명',
          '대표자명',
          '이메일',
          '연락처',
          '분야',
          'IR/소개서',
          '최근 로그인',
          '등록일',
        ];
    const fieldsOf = (u: AssignableUser | null) =>
      (u?.field_ids ?? [])
        .map((id) => fieldNameById.get(id))
        .filter(Boolean)
        .join(', ');
    const loginOf = (u: AssignableUser | null) =>
      u?.last_login_at ? formatDateTime(u.last_login_at, DISPLAY_TZ) : '미로그인';
    const createdOf = (u: AssignableUser | null) =>
      u?.created_at ? formatDateTime(u.created_at, DISPLAY_TZ) : '';
    const rows = [...participants]
      .sort((a, b) => (userOf(a)?.name ?? '').localeCompare(userOf(b)?.name ?? '', 'ko'))
      .map((p) => {
        const u = userOf(p);
        if (isExpert) {
          const code = p.default_table_id ? (tableCodeById.get(p.default_table_id) ?? '') : '';
          return [
            u?.name ?? '',
            u?.expert_organization ?? '',
            u?.expert_position ?? '',
            u?.email ?? '',
            u?.phone_number ?? '',
            fieldsOf(u),
            code,
            loginOf(u),
            createdOf(u),
          ];
        }
        return [
          u?.name ?? '',
          u?.company_name ?? '',
          u?.representative_name ?? '',
          u?.email ?? '',
          u?.phone_number ?? '',
          fieldsOf(u),
          u?.proposal_file_url ? '제출' : '미제출',
          loginOf(u),
          createdOf(u),
        ];
      });
    const csv = toCsv(headers, rows);
    // 엑셀 한글 깨짐 방지를 위해 UTF-8 BOM 부착.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `참가${PARTICIPANT_ROLE_LABELS[role]}명단.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo<DataTableColumn<EventParticipantRow>[]>(() => {
    // 기본정보 컬럼 — 스타트업 DB / 전문가 DB 와 동일한 구성(#·이름·기업명/소속·대표자명/직책·이메일·연락처·분야).
    const cols: DataTableColumn<EventParticipantRow>[] = [
      {
        key: 'no',
        header: 'No.',
        cell: (_p, index) => (
          <span className="tabular-nums text-neutral-base/50">{getRowNumber(index)}</span>
        ),
      },
      {
        key: 'name',
        header: '이름',
        sortable: true,
        cell: (p) => (
          <span className="font-semibold text-neutral-base">{dash(userOf(p)?.name)}</span>
        ),
      },
      isExpert
        ? {
            key: 'company',
            header: '소속',
            sortable: true,
            cell: (p) => (
              <span className="whitespace-nowrap">{dash(userOf(p)?.expert_organization)}</span>
            ),
          }
        : {
            key: 'company',
            header: '기업명',
            sortable: true,
            cell: (p) => (
              <span className="whitespace-nowrap font-medium text-neutral-base">
                {dash(userOf(p)?.company_name)}
              </span>
            ),
          },
      isExpert
        ? {
            key: 'sub',
            header: '직책',
            cell: (p) => (
              <span className="whitespace-nowrap">{dash(userOf(p)?.expert_position)}</span>
            ),
          }
        : {
            key: 'sub',
            header: '대표자명',
            cell: (p) => (
              <span className="whitespace-nowrap">{dash(userOf(p)?.representative_name)}</span>
            ),
          },
      {
        key: 'email',
        header: '이메일',
        cell: (p) => <span className="text-neutral-base/80">{dash(userOf(p)?.email)}</span>,
      },
      {
        key: 'phone',
        header: '연락처',
        cell: (p) => <span className="whitespace-nowrap">{dash(userOf(p)?.phone_number)}</span>,
      },
      {
        key: 'fields',
        header: '분야',
        cell: (p) => <FieldsCell ids={userOf(p)?.field_ids ?? []} nameById={fieldNameById} />,
      },
    ];

    // 세팅값 컬럼 — 스타트업=IR/소개서(스타트업 DB 와 동일한 인라인 업로더) / 전문가=기본 테이블.
    // 셀 클릭이 행 상세 모달을 열지 않도록 stopPropagation.
    if (!isExpert) {
      cols.push({
        key: 'proposal',
        header: 'IR/소개서',
        cell: (p) => {
          const u = userOf(p);
          if (!u) return <span className="text-neutral-base/50">-</span>;
          return (
            <span onClick={(e) => e.stopPropagation()}>
              <ProposalStatusCell user={u} />
            </span>
          );
        },
      });
    } else {
      cols.push({
        key: 'table',
        header: '배정 테이블',
        cell: (p) => {
          const code = p.default_table_id ? tableCodeById.get(p.default_table_id) : null;
          return code ? (
            <Badge tone="muted" className="whitespace-nowrap text-neutral-base/80">
              {code}
            </Badge>
          ) : (
            <span className="text-xs text-neutral-base/40">미지정</span>
          );
        },
      });
    }

    // 운영 컬럼(스타트업 DB 와 동일) — 최근 로그인 / 등록일.
    cols.push(
      {
        key: 'last_login',
        header: '최근 로그인',
        sortable: true,
        cell: (p) => {
          const at = userOf(p)?.last_login_at;
          return at ? (
            <span className="whitespace-nowrap text-neutral-base/80">
              {formatDateTime(at, DISPLAY_TZ)}
            </span>
          ) : (
            <span className="text-neutral-base/50">미로그인</span>
          );
        },
      },
      {
        key: 'created_at',
        header: '등록일',
        sortable: true,
        cell: (p) => {
          const at = userOf(p)?.created_at;
          return (
            <span className="whitespace-nowrap text-neutral-base/70">
              {at ? formatDateTime(at, DISPLAY_TZ) : '-'}
            </span>
          );
        },
      },
    );

    cols.push({
      key: 'actions',
      header: '조작',
      align: 'center',
      cell: (p) => {
        const u = userOf(p);
        if (!u) return <span className="text-xs text-neutral-base/30">-</span>;
        return (
          <div
            className="flex flex-nowrap justify-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <RowAction onClick={() => setEditTarget(u)}>수정</RowAction>
            <RowAction onClick={() => setLinkTarget(u)}>링크</RowAction>
            <RowAction onClick={() => setInvalidateTarget(u)}>세션무효화</RowAction>
            {!locked && <RowAction onClick={() => requestRemove(p)}>행사 제외</RowAction>}
          </div>
        );
      },
    });

    // 좌측 선택 체크박스(복수 제외용) — 잠금 상태에서는 노출하지 않는다.
    if (!locked) {
      cols.unshift({
        key: 'select',
        header: (
          <button
            type="button"
            onClick={toggleAllPage}
            aria-pressed={allPageSelected}
            aria-label="현재 페이지 전체 선택"
            className="inline-flex items-center"
          >
            <SelectBox checked={allPageSelected} />
          </button>
        ),
        align: 'center',
        className: 'w-10',
        cell: (p) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleOne(p.id);
            }}
            aria-pressed={selected.has(p.id)}
            aria-label="선택"
            className="inline-flex items-center"
          >
            <SelectBox checked={selected.has(p.id)} />
          </button>
        ),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isExpert,
    userById,
    tableCodeById,
    locked,
    remove,
    bookingCountByUser,
    fieldNameById,
    selected,
    allPageSelected,
    pageRows,
    table.totalFiltered,
    table.page,
    table.pageSize,
  ]);

  const roleLabel = isExpert ? '전문가' : '기업';
  let confirmMessage: ReactNode = null;
  if (confirmTarget?.kind === 'single') {
    const u = userById.get(confirmTarget.participant.user_id);
    const name = (isExpert ? u?.name : (u?.company_name ?? u?.name)) ?? '이름 미상';
    const count = bookingCountByUser.get(confirmTarget.participant.user_id) ?? 0;
    confirmMessage = (
      <>
        <b>{name}</b> {roleLabel}에 배치 <b>{count}건</b>이 있습니다. 제외하면 이 배치가 <b>해제</b>
        되어 그 시간은 다시 배정할 수 있게 됩니다. (이미 상담일지가 작성된 완료 세션은 <b>취소</b>로
        기록이 보존됩니다.) 계속하시겠습니까?
      </>
    );
  } else if (confirmTarget?.kind === 'bulk') {
    const affected = confirmTarget.ids.filter((id) => {
      const uid = userIdByParticipantId.get(id);
      return uid ? (bookingCountByUser.get(uid) ?? 0) > 0 : false;
    }).length;
    const total = confirmTarget.ids.reduce((sum, id) => {
      const uid = userIdByParticipantId.get(id);
      return sum + (uid ? (bookingCountByUser.get(uid) ?? 0) : 0);
    }, 0);
    confirmMessage = (
      <>
        선택한 {confirmTarget.ids.length}명 중 <b>{affected}명</b>에게 배치가 있습니다. 제외하면
        관련 배치 <b>{total}건</b>이 <b>해제</b>되어 그 시간은 다시 배정할 수 있게 됩니다. (완료
        세션은 <b>취소</b>로 보존) 계속하시겠습니까?
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <FilterBar>
        <SearchInput
          value={table.search}
          onChange={table.setSearch}
          placeholder={`${PARTICIPANT_ROLE_LABELS[role]} 이름·기업/소속·이메일·연락처 검색`}
        />
        {!isExpert && (
          <FilterChips<FileFilter>
            value={fileFilter}
            onChange={setFileFilter}
            ariaLabel="소개서 첨부 필터"
            options={[
              { value: 'ALL', label: '전체' },
              { value: 'WITH', label: '소개서 첨부' },
              { value: 'WITHOUT', label: '소개서 없음' },
            ]}
          />
        )}
        <FilterChips<LoginFilter>
          value={loginFilter}
          onChange={setLoginFilter}
          ariaLabel="로그인 이력 필터"
          options={[
            { value: 'ALL', label: '로그인 전체' },
            { value: 'IN', label: '로그인 있음' },
            { value: 'NONE', label: '미로그인' },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <SectionActionButton onClick={handleExportCsv} disabled={participants.length === 0}>
            CSV 내보내기
          </SectionActionButton>
          {addSlot}
        </div>
      </FilterBar>
      {!locked && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
          <span className="text-sm font-medium text-neutral-base">
            {selectedIds.length}명 선택됨
          </span>
          <div className="flex items-center gap-2">
            <SectionActionButton onClick={clearSelected}>선택 해제</SectionActionButton>
            <SectionActionButton
              tone="danger"
              onClick={requestBulkRemove}
              loading={removeMany.isPending}
            >
              선택 {selectedIds.length}명 제외
            </SectionActionButton>
          </div>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(p) => p.id}
        sort={table.sort}
        onSort={table.toggleSort}
        onRowClick={(p) => {
          const u = userById.get(p.user_id);
          if (u) onOpenDetail(u);
        }}
        minWidthClass="min-w-[1360px]"
        emptyMessage={
          participants.length === 0
            ? `지정된 ${PARTICIPANT_ROLE_LABELS[role]}가 없습니다.`
            : '검색 조건에 맞는 참가자가 없습니다.'
        }
      />
      <Pagination
        page={table.page}
        totalPages={table.totalPages}
        pageSize={table.pageSize}
        total={table.totalFiltered}
        onPageChange={table.setPage}
      />
      <ConfirmModal
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={`${roleLabel} 제외`}
        message={confirmMessage}
        confirmLabel="제외하고 배치 해제"
        onConfirm={handleConfirmRemove}
        loading={remove.isPending || removeMany.isPending}
      />
      <UserDetailModal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        user={editTarget ? toEditableParticipant(editTarget) : null}
        defaultRole={role}
      />
      <EmergencyLinkModal
        open={linkTarget !== null}
        onClose={() => setLinkTarget(null)}
        user={linkTarget}
      />
      <ConfirmModal
        open={invalidateTarget !== null}
        onClose={() => setInvalidateTarget(null)}
        title="세션 무효화"
        confirmLabel="무효화"
        requireReason
        reasonLabel="무효화 사유"
        reasonPlaceholder="예: 현장 확인 후 기존 로그인 세션 차단"
        loading={invalidate.isPending}
        message={
          <>
            <span className="font-semibold">{invalidateTarget?.name}</span> 님의 기존 로그인 세션을
            모두 무효화합니다.
          </>
        }
        onConfirm={(reason) => {
          if (!invalidateTarget) return;
          invalidate.mutate(
            { id: invalidateTarget.id, reason },
            {
              onSuccess: () => {
                setInvalidateTarget(null);
                toast.success('세션을 무효화했습니다.');
              },
              onError: (e) =>
                toast.error('세션을 무효화하지 못했습니다.', { description: (e as Error).message }),
            },
          );
        }}
      />
    </div>
  );
}
