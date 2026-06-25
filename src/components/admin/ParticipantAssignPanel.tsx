import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import {
  useAddParticipants,
  useRemoveParticipant,
  useSetDefaultTable,
} from '@/hooks/useEventDetailMutations';
import { participantLabel, PARTICIPANT_ROLE_LABELS } from '@/lib/labels';
import type { AssignableUser, EventParticipantRow, EventTable } from '@/types/eventDetail';
import type { ParticipantRole } from '@/types/user';

interface ParticipantAssignPanelProps {
  eventId: string;
  participants: EventParticipantRow[];
  assignableUsers: AssignableUser[];
  tables: EventTable[];
  /** 취소 행사 등 잠금 상태에서는 편집 불가. */
  locked: boolean;
}

/**
 * 참가자 지정(DRAFT) 패널 (page_admin_event_detail.md §2.1).
 * 전문가/스타트업 서브탭 + 미지정 후보 선택 추가 + 현재 명단(전문가 기본 테이블 지정·제외).
 */
export function ParticipantAssignPanel({
  eventId,
  participants,
  assignableUsers,
  tables,
  locked,
}: ParticipantAssignPanelProps) {
  const [role, setRole] = useState<ParticipantRole>('STARTUP');

  const userById = useMemo(
    () => new Map(assignableUsers.map((u) => [u.id, u])),
    [assignableUsers],
  );

  const current = useMemo(
    () => participants.filter((p) => p.participant_type === role),
    [participants, role],
  );
  const assignedIds = useMemo(
    () => new Set(participants.map((p) => p.user_id)),
    [participants],
  );
  const candidates = useMemo(
    () => assignableUsers.filter((u) => u.role === role && !assignedIds.has(u.id)),
    [assignableUsers, role, assignedIds],
  );

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-neutral-base">참가자 지정</h2>
        <div className="flex gap-1.5">
          {(['STARTUP', 'EXPERT'] as ParticipantRole[]).map((r) => {
            const active = role === r;
            const count = participants.filter((p) => p.participant_type === r).length;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-white text-neutral-base hover:bg-surface'
                }`}
              >
                {PARTICIPANT_ROLE_LABELS[r]} {count}
              </button>
            );
          })}
        </div>
      </div>

      {!locked && (
        <AddCandidates eventId={eventId} role={role} candidates={candidates} />
      )}

      <CurrentList
        eventId={eventId}
        role={role}
        participants={current}
        userById={userById}
        tables={tables}
        locked={locked}
      />
    </Card>
  );
}

/** 미지정 후보 다중 선택 + 일괄 추가. 검색으로 좁힌다. */
function AddCandidates({
  eventId,
  role,
  candidates,
}: {
  eventId: string;
  role: ParticipantRole;
  candidates: AssignableUser[];
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const add = useAddParticipants(eventId);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return candidates;
    return candidates.filter((u) => participantLabel(u).toLowerCase().includes(kw));
  }, [candidates, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    add.mutate(
      { userIds: [...selected], type: role },
      { onSuccess: () => setSelected(new Set()) },
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-base">
          {PARTICIPANT_ROLE_LABELS[role]} 추가
        </span>
        <Button onClick={submit} loading={add.isPending} disabled={selected.size === 0}>
          선택 {selected.size}명 추가
        </Button>
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="이름·기업명 검색"
        aria-label="후보 검색"
        className="w-full max-w-xs rounded-lg border border-border bg-white px-3 py-2 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
      {add.isError && <Alert tone="error">{(add.error as Error).message}</Alert>}
      {candidates.length === 0 ? (
        <p className="py-2 text-sm text-neutral-base/60">추가할 수 있는 후보가 없습니다.</p>
      ) : (
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
          {filtered.map((u) => {
            const on = selected.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  on
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-white text-neutral-base hover:bg-surface'
                }`}
              >
                {participantLabel(u)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 현재 참가 명단. 전문가는 기본 테이블 셀렉트, 공통 제외 버튼. */
function CurrentList({
  eventId,
  role,
  participants,
  userById,
  tables,
  locked,
}: {
  eventId: string;
  role: ParticipantRole;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  tables: EventTable[];
  locked: boolean;
}) {
  const remove = useRemoveParticipant(eventId);
  const setTable = useSetDefaultTable(eventId);
  const isExpert = role === 'EXPERT';

  if (participants.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
        지정된 {PARTICIPANT_ROLE_LABELS[role]}가 없습니다.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {participants.map((p) => {
        const u = userById.get(p.user_id);
        return (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <span className="min-w-0 break-words text-sm font-medium text-neutral-base">
              {u ? participantLabel(u) : '(알 수 없는 사용자)'}
            </span>
            <div className="flex items-center gap-2">
              {isExpert && (
                <select
                  value={p.default_table_id ?? ''}
                  disabled={locked || setTable.isPending}
                  onChange={(e) =>
                    setTable.mutate({
                      participantId: p.id,
                      tableId: e.target.value || null,
                    })
                  }
                  aria-label="기본 테이블"
                  className="rounded-lg border border-border bg-white px-2 py-1 text-sm text-neutral-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
                >
                  <option value="">기본 테이블 없음</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.table_code}
                    </option>
                  ))}
                </select>
              )}
              {!locked && (
                <button
                  type="button"
                  onClick={() => remove.mutate(p.id)}
                  className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-brand transition-colors hover:bg-danger-surface"
                >
                  제외
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
