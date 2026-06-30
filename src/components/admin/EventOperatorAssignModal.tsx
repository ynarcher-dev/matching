import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { SelectField } from '@/components/common/SelectField';
import { Alert } from '@/components/common/Alert';
import { Spinner } from '@/components/common/Spinner';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { useEventOperators, useOperators } from '@/hooks/useOperators';
import { useGrantEventOperator, useRevokeEventOperator } from '@/hooks/useOperatorMutations';
import { OPERATOR_PERMISSION_LABELS } from '@/lib/labels';
import type { EventOperatorAssignment } from '@/hooks/useOperators';
import type { OperatorPermission } from '@/types/operator';

interface EventOperatorAssignModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
}

const PERMISSION_OPTIONS = (Object.keys(OPERATOR_PERMISSION_LABELS) as OperatorPermission[]).map(
  (p) => ({ value: p, label: `${OPERATOR_PERMISSION_LABELS[p]} (${p})` }),
);

/**
 * 행사 기준 운영자 배정 모달 (8-D, functional_followup_plan.md T4).
 * 행사 상세에서 최고관리자가 이 행사의 운영자를 배정/등급 변경/회수한다.
 * 운영자 기준 OperatorPermissionModal 의 역방향(event→operators). 모두 사유 필수.
 * 최고관리자는 전 행사 접근이 보장되므로 선택지에서 제외한다.
 */
export function EventOperatorAssignModal({
  open,
  onClose,
  eventId,
  eventTitle,
}: EventOperatorAssignModalProps) {
  const { data: assignments, isLoading } = useEventOperators(open ? eventId : null);
  const { data: operators } = useOperators();
  const grant = useGrantEventOperator();
  const revoke = useRevokeEventOperator();

  const [userId, setUserId] = useState('');
  const [permission, setPermission] = useState<OperatorPermission>('MANAGER');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<EventOperatorAssignment | null>(null);

  useEffect(() => {
    if (open) {
      setUserId('');
      setPermission('MANAGER');
      setReason('');
      setTouched(false);
      setRevokeTarget(null);
      grant.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  // 활성·비-최고관리자 운영자만 후보로 노출.
  const operatorOptions = useMemo(
    () => [
      { value: '', label: '운영자 선택…' },
      ...(operators ?? [])
        .filter((o) => o.active && !o.is_super_admin)
        .map((o) => ({ value: o.id, label: `${o.name} (${o.email})` })),
    ],
    [operators],
  );

  const existingByUser = useMemo(
    () => new Map((assignments ?? []).map((a) => [a.user_id, a.permission])),
    [assignments],
  );

  const formInvalid = userId === '' || reason.trim().length === 0;
  const currentPermission = userId ? existingByUser.get(userId) : undefined;

  const onGrant = () => {
    if (formInvalid) {
      setTouched(true);
      return;
    }
    grant.mutate(
      { event_id: eventId, user_id: userId, permission, reason: reason.trim() },
      {
        onSuccess: () => {
          setUserId('');
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
        title={`운영자 배정 — ${eventTitle}`}
        footer={<Button onClick={onClose}>닫기</Button>}
      >
        <div className="flex flex-col gap-5">
          {/* 현재 배정된 운영자 목록 */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-neutral-base">이 행사에 배정된 운영자</h3>
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner className="h-5 w-5" />
              </div>
            ) : (assignments ?? []).length === 0 ? (
              <p className="rounded-lg border border-border bg-surface px-3 py-3 text-sm text-neutral-base/70">
                배정된 운영자가 없습니다. 최고관리자는 모든 행사에 접근할 수 있습니다.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {(assignments ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-base">
                        {a.operator_name}
                      </p>
                      <span className="text-xs text-neutral-base/70">
                        {a.operator_email && `${a.operator_email} · `}
                        {OPERATOR_PERMISSION_LABELS[a.permission]} ({a.permission})
                      </span>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setRevokeTarget(a)}
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

          {/* 운영자 배정/변경 */}
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-neutral-base">운영자 배정 / 등급 변경</h3>
            {grant.isError && <Alert tone="error">{(grant.error as Error).message}</Alert>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField
                label="운영자"
                options={operatorOptions}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                error={touched && userId === '' ? '운영자를 선택해 주세요.' : undefined}
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
                이 운영자는 이미 <b>{OPERATOR_PERMISSION_LABELS[currentPermission]}</b> 권한이
                있습니다. 배정하면 선택한 등급으로 변경됩니다.
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-grant-reason" className="text-sm font-semibold text-neutral-base">
                사유
              </label>
              <textarea
                id="event-grant-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="예: 해당 행사 운영 담당 배정"
                className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
                  touched && reason.trim().length === 0 ? 'border-brand' : 'border-border'
                }`}
              />
              {touched && reason.trim().length === 0 && (
                <p className="text-sm font-medium text-brand">사유를 입력해 주세요.</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={onGrant} loading={grant.isPending}>
                {currentPermission ? '등급 변경' : '운영자 배정'}
              </Button>
            </div>
          </section>
        </div>
      </Modal>

      <ConfirmModal
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="운영자 권한 회수"
        confirmLabel="회수"
        requireReason
        reasonLabel="회수 사유"
        reasonPlaceholder="예: 담당 변경으로 권한 회수"
        loading={revoke.isPending}
        error={revoke.error ? (revoke.error as Error).message : null}
        message={
          <>
            <span className="font-semibold">{revokeTarget?.operator_name}</span> 님의 이 행사 권한(
            {revokeTarget && OPERATOR_PERMISSION_LABELS[revokeTarget.permission]})을 회수합니다.
          </>
        }
        onConfirm={(r) => {
          if (!revokeTarget) return;
          revoke.mutate(
            { event_id: eventId, user_id: revokeTarget.user_id, reason: r },
            { onSuccess: () => setRevokeTarget(null) },
          );
        }}
      />
    </>
  );
}
