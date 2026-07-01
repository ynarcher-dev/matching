import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { SelectField } from '@/components/common/SelectField';
import { Alert } from '@/components/common/Alert';
import { Spinner } from '@/components/common/Spinner';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { useEventOperatorRoles } from '@/hooks/useOperators';
import { useEvents } from '@/hooks/useEvents';
import { useGrantEventOperator, useRevokeEventOperator } from '@/hooks/useOperatorMutations';
import { OPERATOR_PERMISSION_LABELS } from '@/lib/labels';
import type { EventOperatorRole, Operator, OperatorPermission } from '@/types/operator';

interface OperatorPermissionModalProps {
  open: boolean;
  onClose: () => void;
  operator: Operator | null;
}

const PERMISSION_OPTIONS = (Object.keys(OPERATOR_PERMISSION_LABELS) as OperatorPermission[]).map(
  (p) => ({ value: p, label: `${OPERATOR_PERMISSION_LABELS[p]} (${p})` }),
);

/**
 * 운영자 행사별 권한 배정 모달 (page_admin_operator_permissions.md §4.2, 슬라이스 E).
 * 현재 활성 권한 목록 + 부여/등급 변경(grant=멱등) + 회수. 모두 사유 필수.
 */
export function OperatorPermissionModal({ open, onClose, operator }: OperatorPermissionModalProps) {
  const { data: roles, isLoading } = useEventOperatorRoles(open ? (operator?.id ?? null) : null);
  const { data: events } = useEvents();
  const grant = useGrantEventOperator();
  const revoke = useRevokeEventOperator();

  const [eventId, setEventId] = useState('');
  const [permission, setPermission] = useState<OperatorPermission>('MANAGER');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<EventOperatorRole | null>(null);

  useEffect(() => {
    if (open) {
      setEventId('');
      setPermission('MANAGER');
      setReason('');
      setTouched(false);
      setRevokeTarget(null);
      grant.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, operator]);

  const eventOptions = useMemo(
    () => [
      { value: '', label: '행사 선택…' },
      ...(events ?? []).map((e) => ({ value: e.id, label: e.title })),
    ],
    [events],
  );

  const existingByEvent = useMemo(
    () => new Map((roles ?? []).map((r) => [r.event_id, r.permission])),
    [roles],
  );

  if (!operator) return null;

  const formInvalid = eventId === '' || reason.trim().length === 0;
  const currentPermission = eventId ? existingByEvent.get(eventId) : undefined;

  const onGrant = () => {
    if (formInvalid) {
      setTouched(true);
      return;
    }
    grant.mutate(
      { event_id: eventId, user_id: operator.id, permission, reason: reason.trim() },
      {
        onSuccess: () => {
          setEventId('');
          setReason('');
          setTouched(false);
        },
      },
    );
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`행사 권한 배정 — ${operator.name}`}
        footer={<Button onClick={onClose}>닫기</Button>}
      >
        <div className="flex flex-col gap-5">
          {/* 현재 권한 목록 */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-neutral-base">현재 배정된 행사 권한</h3>
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner className="h-5 w-5" />
              </div>
            ) : (roles ?? []).length === 0 ? (
              <p className="rounded-lg border border-border bg-surface px-3 py-3 text-sm text-neutral-base/70">
                배정된 행사 권한이 없습니다.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {(roles ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-base">
                        {r.event_title}
                      </p>
                      <span className="text-xs text-neutral-base/70">
                        {OPERATOR_PERMISSION_LABELS[r.permission]} ({r.permission})
                      </span>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setRevokeTarget(r)}
                      variant="outline"
                      size="sm"
                      className="shrink-0 text-brand"
                    >
                      회수
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 권한 부여/변경 */}
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-neutral-base">권한 부여 / 등급 변경</h3>
            {grant.isError && <Alert tone="error">{(grant.error as Error).message}</Alert>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField
                label="행사"
                options={eventOptions}
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                error={touched && eventId === '' ? '행사를 선택해 주세요.' : undefined}
              />
              <SelectField
                label="권한 등급"
                options={PERMISSION_OPTIONS}
                value={permission}
                onChange={(e) => setPermission(e.target.value as OperatorPermission)}
              />
            </div>
            {currentPermission && (
              <Alert tone="info">
                이 행사에는 이미 <b>{OPERATOR_PERMISSION_LABELS[currentPermission]}</b> 권한이
                있습니다. 부여하면 선택한 등급으로 변경됩니다.
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="grant-reason" className="text-sm font-semibold text-neutral-base">
                사유
              </label>
              <textarea
                id="grant-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="예: 해당 행사 운영 담당 배정"
                className={`h-9 w-full rounded-lg border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
                  touched && reason.trim().length === 0 ? 'border-brand' : 'border-border'
                }`}
              />
              {touched && reason.trim().length === 0 && (
                <p className="text-sm font-medium text-brand">사유를 입력해 주세요.</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={onGrant} loading={grant.isPending}>
                {currentPermission ? '등급 변경' : '권한 부여'}
              </Button>
            </div>
          </section>
        </div>
      </Modal>

      <ConfirmModal
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="행사 권한 회수"
        confirmLabel="회수"
        requireReason
        reasonLabel="회수 사유"
        reasonPlaceholder="예: 담당 변경으로 권한 회수"
        loading={revoke.isPending}
        error={revoke.error ? (revoke.error as Error).message : null}
        message={
          <>
            <span className="font-semibold">{operator.name}</span> 님의{' '}
            <span className="font-semibold">{revokeTarget?.event_title}</span> 권한(
            {revokeTarget && OPERATOR_PERMISSION_LABELS[revokeTarget.permission]})을 회수합니다.
          </>
        }
        onConfirm={(r) => {
          if (!revokeTarget) return;
          revoke.mutate(
            { event_id: revokeTarget.event_id, user_id: operator.id, reason: r },
            { onSuccess: () => setRevokeTarget(null) },
          );
        }}
      />
    </>
  );
}
