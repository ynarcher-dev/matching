import { useMemo, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { UserTable } from '@/components/admin/UserTable';
import { UserDetailModal } from '@/components/admin/UserDetailModal';
import { CsvBulkUploader } from '@/components/admin/CsvBulkUploader';
import { EmergencyLinkModal } from '@/components/admin/EmergencyLinkModal';
import { useParticipants } from '@/hooks/useUsers';
import { useFields } from '@/hooks/useFields';
import { useSoftDeleteUser, useInvalidateSessions } from '@/hooks/useUserMutations';
import { PARTICIPANT_ROLE_LABELS } from '@/lib/labels';
import type { ParticipantRole, ParticipantWithAuth } from '@/types/user';

const ROLE_TABS: { value: ParticipantRole; label: string }[] = [
  { value: 'STARTUP', label: `${PARTICIPANT_ROLE_LABELS.STARTUP} 목록` },
  { value: 'EXPERT', label: `${PARTICIPANT_ROLE_LABELS.EXPERT} 목록` },
];

/**
 * 참가자 DB 관리 페이지 (page_admin_user_management.md §1).
 * 역할 탭 + 검색 + 개별 추가/수정 + CSV 일괄 업로드 + 세션 무효화/1회용 로그인 링크.
 */
export function UserListView() {
  const { data: users, isLoading, isError, error } = useParticipants();
  const { data: fields } = useFields();
  const softDelete = useSoftDeleteUser();
  const invalidate = useInvalidateSessions();

  const fieldNameById = useMemo(
    () => new Map((fields ?? []).map((f) => [f.id, f.name])),
    [fields],
  );

  const [role, setRole] = useState<ParticipantRole>('STARTUP');
  const [search, setSearch] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ParticipantWithAuth | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ParticipantWithAuth | null>(null);
  const [invalidateTarget, setInvalidateTarget] = useState<ParticipantWithAuth | null>(null);
  const [linkTarget, setLinkTarget] = useState<ParticipantWithAuth | null>(null);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (u.role !== role) return false;
      if (!keyword) return true;
      return (
        u.name.toLowerCase().includes(keyword) ||
        u.email.toLowerCase().includes(keyword) ||
        (u.company_name ?? '').toLowerCase().includes(keyword)
      );
    });
  }, [users, role, search]);

  // CSV 중복 검사용 활성 이메일 집합(전 역할 공통).
  const existingEmails = useMemo(
    () => new Set((users ?? []).map((u) => u.email.toLowerCase())),
    [users],
  );

  const openCreate = () => {
    setEditTarget(null);
    setDetailOpen(true);
  };
  const openEdit = (user: ParticipantWithAuth) => {
    setEditTarget(user);
    setDetailOpen(true);
  };

  if (isLoading) return <FullScreenLoader />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-base">참가자 DB 관리</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            CSV 일괄 업로드
          </Button>
          <Button onClick={openCreate}>+ 개별 추가</Button>
        </div>
      </header>

      {isError && (
        <Alert tone="error">참가자 목록을 불러오지 못했습니다. {(error as Error).message}</Alert>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {ROLE_TABS.map((tab) => {
            const active = role === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setRole(tab.value)}
                className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-white text-neutral-base hover:bg-surface'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름·이메일·기업명 검색"
          aria-label="참가자 검색"
          className="w-full max-w-xs rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          hasAny={(users ?? []).some((u) => u.role === role)}
          roleLabel={PARTICIPANT_ROLE_LABELS[role]}
          onCreate={openCreate}
        />
      ) : (
        <UserTable
          users={filtered}
          role={role}
          fieldNameById={fieldNameById}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onInvalidate={setInvalidateTarget}
          onIssueLink={setLinkTarget}
        />
      )}

      <UserDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        user={editTarget}
        defaultRole={role}
      />

      <CsvBulkUploader
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        existingEmails={existingEmails}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="참가자 삭제"
        confirmLabel="삭제"
        loading={softDelete.isPending}
        error={softDelete.error ? (softDelete.error as Error).message : null}
        message={
          <>
            <span className="font-semibold">{deleteTarget?.name}</span> 님을 목록에서 삭제합니다.
            기존 데이터는 보존(소프트 삭제)되며 로그인은 즉시 차단됩니다.
          </>
        }
        onConfirm={() => {
          if (deleteTarget) {
            softDelete.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
      />

      <ConfirmModal
        open={invalidateTarget !== null}
        onClose={() => setInvalidateTarget(null)}
        title="세션 무효화"
        confirmLabel="무효화"
        requireReason
        reasonLabel="무효화 사유"
        reasonPlaceholder="예: 분실 신고로 기존 로그인 세션 차단 요청"
        loading={invalidate.isPending}
        error={invalidate.error ? (invalidate.error as Error).message : null}
        message={
          <>
            <span className="font-semibold">{invalidateTarget?.name}</span> 님의 기존 로그인 세션을
            모두 무효화합니다. 진행 중인 인증번호·발급된 로그인 링크도 함께 회수됩니다.
          </>
        }
        onConfirm={(reason) => {
          if (invalidateTarget) {
            invalidate.mutate(
              { id: invalidateTarget.id, reason },
              { onSuccess: () => setInvalidateTarget(null) },
            );
          }
        }}
      />

      <EmergencyLinkModal
        open={linkTarget !== null}
        onClose={() => setLinkTarget(null)}
        user={linkTarget}
      />
    </div>
  );
}

function EmptyState({
  hasAny,
  roleLabel,
  onCreate,
}: {
  hasAny: boolean;
  roleLabel: string;
  onCreate: () => void;
}) {
  if (hasAny) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-neutral-base/70">검색 조건에 맞는 참가자가 없습니다.</p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col items-center gap-4 p-12 text-center">
      <p className="text-base font-semibold text-neutral-base">
        등록된 {roleLabel}이(가) 없습니다. 개별 추가하거나 CSV 로 일괄 등록해 보세요.
      </p>
      <Button onClick={onCreate}>+ 개별 추가</Button>
    </Card>
  );
}
