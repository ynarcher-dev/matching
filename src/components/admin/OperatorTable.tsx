import { Card } from '@/components/common/Card';
import { OPERATOR_ROLE_LABELS } from '@/lib/labels';
import { canDeactivate } from '@/lib/operator';
import type { Operator } from '@/types/operator';

interface OperatorTableProps {
  operators: Operator[];
  currentUserId: string;
  onEdit: (op: Operator) => void;
  onToggleActive: (op: Operator) => void;
  onResetPassword: (op: Operator) => void;
  onAssign: (op: Operator) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '–';
  return iso.slice(0, 10);
}

/** 운영자 목록 테이블(모바일 가로 스크롤). */
export function OperatorTable({
  operators,
  currentUserId,
  onEdit,
  onToggleActive,
  onResetPassword,
  onAssign,
}: OperatorTableProps) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-border bg-surface text-neutral-base/70">
          <tr>
            <th className="px-4 py-3 font-semibold">이름</th>
            <th className="px-4 py-3 font-semibold">이메일</th>
            <th className="px-4 py-3 font-semibold">역할</th>
            <th className="px-4 py-3 font-semibold">상태</th>
            <th className="px-4 py-3 font-semibold">배정 행사</th>
            <th className="px-4 py-3 font-semibold">최근 로그인</th>
            <th className="px-4 py-3 font-semibold">생성일</th>
            <th className="px-4 py-3 text-right font-semibold">조작</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {operators.map((op) => (
            <tr key={op.id} className={op.active ? '' : 'bg-surface/60'}>
              <td className="px-4 py-3">
                <span className="font-semibold text-neutral-base">{op.name}</span>
                {op.id === currentUserId && (
                  <span className="ml-1.5 text-xs text-neutral-base/60">(나)</span>
                )}
              </td>
              <td className="px-4 py-3 text-neutral-base/80">{op.email}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1">
                  <span className="rounded-full border border-border bg-white px-2 py-0.5 text-xs font-semibold text-neutral-base">
                    {OPERATOR_ROLE_LABELS[op.role]}
                  </span>
                  {op.is_super_admin && (
                    <span className="rounded-full border border-brand bg-danger-surface px-2 py-0.5 text-xs font-semibold text-brand">
                      최고관리자
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3">
                {op.active ? (
                  <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    활성
                  </span>
                ) : (
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-neutral-base/60">
                    비활성
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-neutral-base/80">{op.assigned_event_count}건</td>
              <td className="px-4 py-3 text-neutral-base/80">{formatDate(op.last_sign_in_at)}</td>
              <td className="px-4 py-3 text-neutral-base/80">{formatDate(op.created_at)}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onEdit(op)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => onAssign(op)}
                    disabled={!op.active}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface disabled:opacity-40"
                  >
                    권한 배정
                  </button>
                  <button
                    type="button"
                    onClick={() => onResetPassword(op)}
                    disabled={!op.active}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface disabled:opacity-40"
                  >
                    비밀번호 재설정
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleActive(op)}
                    disabled={op.active && !canDeactivate(op, currentUserId)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${
                      op.active
                        ? 'border-brand text-brand hover:bg-danger-surface'
                        : 'border-border text-neutral-base hover:bg-surface'
                    }`}
                  >
                    {op.active ? '비활성화' : '재활성화'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
