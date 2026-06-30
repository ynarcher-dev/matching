import type { DataTableColumn } from '@/components/common/DataTable';
import { Badge } from '@/components/common/Badge';
import { ActionMenu } from '@/components/common/ActionMenu';
import type { RowAction } from '@/components/common/RowActionGroup';
import type { SortValue } from '@/lib/dataTable';
import { OPERATOR_ROLE_LABELS } from '@/lib/labels';
import { canDeactivate } from '@/lib/operator';
import type { Operator } from '@/types/operator';

interface ColumnHandlers {
  currentUserId: string;
  onEdit: (op: Operator) => void;
  onAssign: (op: Operator) => void;
  onResetPassword: (op: Operator) => void;
  onToggleActive: (op: Operator) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '–';
  return iso.slice(0, 10);
}

/**
 * 운영자 목록 테이블(9-D) 컬럼 정의 + 정렬/검색 헬퍼.
 * 기존 OperatorTable 의 직접 테이블 마크업을 8-C DataTable 컬럼 정의로 일반화하고,
 * 행 액션(수정/권한 배정/비밀번호 재설정/활성 토글)을 공통 ActionMenu 로 묶는다.
 */
export function buildOperatorColumns({
  currentUserId,
  onEdit,
  onAssign,
  onResetPassword,
  onToggleActive,
}: ColumnHandlers): DataTableColumn<Operator>[] {
  return [
    {
      key: 'name',
      header: '이름',
      sortable: true,
      cell: (op) => (
        <span>
          <span className="font-semibold text-neutral-base">{op.name}</span>
          {op.id === currentUserId && (
            <span className="ml-1.5 text-xs text-neutral-base/60">(나)</span>
          )}
        </span>
      ),
    },
    {
      key: 'email',
      header: '이메일',
      sortable: true,
      cell: (op) => <span className="text-neutral-base/80">{op.email}</span>,
    },
    {
      key: 'role',
      header: '역할',
      cell: (op) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Badge tone="neutral">{OPERATOR_ROLE_LABELS[op.role]}</Badge>
          {op.is_super_admin && <Badge tone="brand">최고관리자</Badge>}
        </span>
      ),
    },
    {
      key: 'active',
      header: '상태',
      cell: (op) =>
        op.active ? <Badge tone="success">활성</Badge> : <Badge tone="muted">비활성</Badge>,
    },
    {
      key: 'assigned',
      header: '배정 행사',
      sortable: true,
      align: 'right',
      cell: (op) => <span className="text-neutral-base/80">{op.assigned_event_count}건</span>,
    },
    {
      key: 'last_sign_in',
      header: '최근 로그인',
      sortable: true,
      cell: (op) => <span className="text-neutral-base/80">{formatDate(op.last_sign_in_at)}</span>,
    },
    {
      key: 'created_at',
      header: '생성일',
      sortable: true,
      cell: (op) => <span className="text-neutral-base/80">{formatDate(op.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '조작',
      align: 'right',
      cell: (op) => {
        const actions: RowAction[] = [
          { key: 'edit', label: '수정', onClick: () => onEdit(op) },
          { key: 'assign', label: '권한 배정', onClick: () => onAssign(op), disabled: !op.active },
          {
            key: 'reset',
            label: '비밀번호 재설정',
            onClick: () => onResetPassword(op),
            disabled: !op.active,
          },
          op.active
            ? {
                key: 'deactivate',
                label: '비활성화',
                tone: 'danger',
                onClick: () => onToggleActive(op),
                disabled: !canDeactivate(op, currentUserId),
              }
            : { key: 'activate', label: '재활성화', onClick: () => onToggleActive(op) },
        ];
        return <ActionMenu actions={actions} />;
      },
    },
  ];
}

/** 정렬 가능한 컬럼 키 → 정렬 값(이름·이메일·배정 행사·최근 로그인·생성일). */
export const operatorSortValues: Record<string, (op: Operator) => SortValue> = {
  name: (op) => op.name,
  email: (op) => op.email,
  assigned: (op) => op.assigned_event_count,
  last_sign_in: (op) => op.last_sign_in_at,
  created_at: (op) => op.created_at,
};

/** 키워드 검색 대상 텍스트(이름·이메일). */
export function operatorSearchText(op: Operator): string {
  return [op.name, op.email].filter(Boolean).join(' ');
}
