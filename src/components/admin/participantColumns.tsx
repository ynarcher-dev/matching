import type { DataTableColumn } from '@/components/common/DataTable';
import {
  FieldsCell,
  LastLoginCell,
  ProposalStatusCell,
  RowAction,
} from '@/components/admin/participantCells';
import { formatDateTime } from '@/lib/datetime';
import type { SortValue } from '@/lib/dataTable';
import type { ParticipantRole, ParticipantWithAuth } from '@/types/user';

const DISPLAY_TZ = 'Asia/Seoul';

interface ColumnHandlers {
  role: ParticipantRole;
  fieldNameById: Map<string, string>;
  getRowNumber: (indexOnPage: number) => number;
  onDelete?: (user: ParticipantWithAuth) => void;
}

export function buildParticipantColumns({
  role,
  fieldNameById,
  getRowNumber,
  onDelete,
}: ColumnHandlers): DataTableColumn<ParticipantWithAuth>[] {
  const isStartup = role === 'STARTUP';

  const columns: DataTableColumn<ParticipantWithAuth>[] = [
    {
      key: 'no',
      header: 'No.',
      cell: (_u, index) => (
        <span className="tabular-nums text-neutral-base/50">{getRowNumber(index)}</span>
      ),
    },
    {
      key: 'name',
      header: '이름',
      sortable: true,
      cell: (u) => <span className="font-semibold text-neutral-base">{u.name}</span>,
    },
    {
      key: 'company',
      header: isStartup ? '기업명' : '소속',
      sortable: true,
      cell: (u) => (isStartup ? (u.company_name ?? '-') : (u.expert_organization ?? '-')),
    },
    {
      key: 'sub',
      header: isStartup ? '대표자명' : '직책',
      cell: (u) => (isStartup ? (u.representative_name ?? '-') : (u.expert_position ?? '-')),
    },
    {
      key: 'email',
      header: '이메일',
      cell: (u) => <span className="text-neutral-base/80">{u.email}</span>,
    },
    { key: 'phone', header: '연락처', cell: (u) => u.phone_number || '-' },
    {
      key: 'fields',
      header: '분야',
      cell: (u) => <FieldsCell ids={u.field_ids} nameById={fieldNameById} />,
    },
    ...(isStartup
      ? [
          {
            key: 'proposal',
            header: 'IR/소개서',
            cell: (u: ParticipantWithAuth) => <ProposalStatusCell user={u} />,
          } satisfies DataTableColumn<ParticipantWithAuth>,
        ]
      : []),
    {
      key: 'last_login',
      header: '최근 로그인',
      sortable: true,
      cell: (u) => <LastLoginCell user={u} />,
    },
    {
      key: 'created_at',
      header: '등록일',
      sortable: true,
      cell: (u) => (
        <span className="whitespace-nowrap text-neutral-base/70">
          {formatDateTime(u.created_at, DISPLAY_TZ)}
        </span>
      ),
    },
    ...(onDelete
      ? [
          {
            key: 'actions',
            header: '조작',
            align: 'center',
            cell: (u: ParticipantWithAuth) => (
              <RowAction danger onClick={() => onDelete(u)}>
                DB 삭제
              </RowAction>
            ),
          } satisfies DataTableColumn<ParticipantWithAuth>,
        ]
      : []),
  ];

  return columns;
}

export function participantSortValues(
  role: ParticipantRole,
): Record<string, (row: ParticipantWithAuth) => SortValue> {
  const isStartup = role === 'STARTUP';
  return {
    name: (u) => u.name,
    company: (u) => (isStartup ? u.company_name : u.expert_organization),
    last_login: (u) => u.last_login_at,
    created_at: (u) => u.created_at,
  };
}

export function participantSearchText(u: ParticipantWithAuth): string {
  return [
    u.name,
    u.company_name,
    u.expert_organization,
    u.representative_name,
    u.expert_position,
    u.email,
    u.phone_number,
  ]
    .filter(Boolean)
    .join(' ');
}
