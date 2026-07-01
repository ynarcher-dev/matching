import { useMemo, useState } from 'react';
import { Alert } from '@/components/common/Alert';
import { SectionActionButton } from '@/components/common/ActionButton';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { DataTable } from '@/components/common/DataTable';
import { SearchInput, FilterChips } from '@/components/common/FilterBar';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { PageToolbar } from '@/components/common/PageToolbar';
import { Pagination } from '@/components/common/Pagination';
import { CsvBulkUploader } from '@/components/admin/CsvBulkUploader';
import { UserDetailModal } from '@/components/admin/UserDetailModal';
import {
  buildParticipantColumns,
  participantSearchText,
  participantSortValues,
} from '@/components/admin/participantColumns';
import { useDataTable } from '@/hooks/useDataTable';
import { useFields } from '@/hooks/useFields';
import { useParticipants } from '@/hooks/useUsers';
import { useSoftDeleteUser } from '@/hooks/useUserMutations';
import { toast } from '@/stores/toastStore';
import { PARTICIPANT_ROLE_LABELS } from '@/lib/labels';
import type { ParticipantRole, ParticipantWithAuth } from '@/types/user';

type FileFilter = 'ALL' | 'WITH' | 'WITHOUT';
type LoginFilter = 'ALL' | 'IN' | 'NONE';

interface ParticipantDbViewProps {
  role: ParticipantRole;
}

export function ParticipantDbView({ role }: ParticipantDbViewProps) {
  const { data: users, isLoading, isError, error } = useParticipants();
  const { data: fields } = useFields();
  const softDelete = useSoftDeleteUser();

  const roleLabel = PARTICIPANT_ROLE_LABELS[role];
  const isStartup = role === 'STARTUP';
  const fileLabel = isStartup ? '소개서' : '프로필';

  const [detailOpen, setDetailOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ParticipantWithAuth | null>(null);
  const [fileFilter, setFileFilter] = useState<FileFilter>('ALL');
  const [loginFilter, setLoginFilter] = useState<LoginFilter>('ALL');

  const fieldNameById = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f.name])), [fields]);

  const roleUsers = useMemo(() => (users ?? []).filter((u) => u.role === role), [users, role]);

  const existingEmails = useMemo(
    () => new Set((users ?? []).map((u) => u.email.toLowerCase())),
    [users],
  );

  const filters = useMemo(() => {
    const preds: Array<(u: ParticipantWithAuth) => boolean> = [];
    const filePath = (u: ParticipantWithAuth) =>
      isStartup ? u.proposal_file_url : u.profile_image_url;

    if (fileFilter === 'WITH') preds.push((u) => Boolean(filePath(u)));
    else if (fileFilter === 'WITHOUT') preds.push((u) => !filePath(u));
    if (loginFilter === 'IN') preds.push((u) => Boolean(u.last_login_at));
    else if (loginFilter === 'NONE') preds.push((u) => !u.last_login_at);
    return preds;
  }, [fileFilter, loginFilter, isStartup]);

  const table = useDataTable(roleUsers, {
    getSearchText: participantSearchText,
    sortValues: participantSortValues(role),
    filters,
    initialSort: { key: 'created_at', direction: 'desc' },
  });

  const getRowNumber = (indexOnPage: number) =>
    table.totalFiltered - ((table.page - 1) * table.pageSize + indexOnPage);

  const columns = useMemo(
    () => buildParticipantColumns({ role, fieldNameById, getRowNumber, onDelete: setDeleteTarget }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, fieldNameById, table.totalFiltered, table.page, table.pageSize],
  );

  if (isLoading) return <FullScreenLoader />;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold text-neutral-base">{roleLabel} DB</h1>
      </header>

      {isError && (
        <Alert tone="error">참가자 목록을 불러오지 못했습니다. {(error as Error).message}</Alert>
      )}

      <PageToolbar
        search={
          <SearchInput
            value={table.search}
            onChange={table.setSearch}
            placeholder="이름, 기업/소속, 이메일, 연락처 검색"
          />
        }
        filters={
          <>
            {isStartup && (
              <FilterChips<FileFilter>
                value={fileFilter}
                onChange={setFileFilter}
                ariaLabel={`${fileLabel} 첨부 필터`}
                options={[
                  { value: 'ALL', label: '전체' },
                  { value: 'WITH', label: `${fileLabel} 첨부` },
                  { value: 'WITHOUT', label: `${fileLabel} 없음` },
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
          </>
        }
        actions={
          <>
            <SectionActionButton onClick={() => setCsvOpen(true)}>
              CSV 일괄 업로드
            </SectionActionButton>
            <SectionActionButton tone="primary" onClick={() => setDetailOpen(true)}>
              + 개별 추가
            </SectionActionButton>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(u) => u.id}
        sort={table.sort}
        onSort={table.toggleSort}
        minWidthClass="min-w-[960px]"
        emptyMessage={
          roleUsers.length > 0
            ? '검색/필터 조건에 맞는 참가자가 없습니다.'
            : `등록된 ${roleLabel}이 없습니다. 개별 추가하거나 CSV로 일괄 등록해 보세요.`
        }
      />

      <Pagination
        page={table.page}
        totalPages={table.totalPages}
        pageSize={table.pageSize}
        total={table.totalFiltered}
        onPageChange={table.setPage}
      />

      <UserDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        user={null}
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
        title="참가자 DB 삭제"
        confirmLabel="DB 삭제"
        loading={softDelete.isPending}
        message={
          <>
            <span className="font-semibold">{deleteTarget?.name}</span> 님을 DB 목록에서 삭제합니다.
            기존 데이터는 보존되며 목록에서는 숨겨집니다.
          </>
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          softDelete.mutate(deleteTarget.id, {
            onSuccess: () => {
              setDeleteTarget(null);
              toast.success('참가자를 DB 목록에서 삭제했습니다.');
            },
            onError: (e) =>
              toast.error('참가자를 삭제하지 못했습니다.', { description: (e as Error).message }),
          });
        }}
      />
    </div>
  );
}
