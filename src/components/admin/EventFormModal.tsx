import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { TextField } from '@/components/common/TextField';
import { SelectField } from '@/components/common/SelectField';
import { Alert } from '@/components/common/Alert';
import { SearchableSelect } from '@/components/common/SearchableSelect';
import { eventFormSchema } from '@/schemas/eventSchemas';
import type { EventFormValues } from '@/schemas/eventSchemas';
import { useCreateEvent, useUpdateEvent } from '@/hooks/useEventMutations';
import { useOperators, useEventOperators } from '@/hooks/useOperators';
import { useGrantEventOperator, useRevokeEventOperator } from '@/hooks/useOperatorMutations';
import { useAuthStore } from '@/stores/authStore';
import { TIMEZONE_OPTIONS, isoToLocalInput } from '@/lib/datetime';
import { SATISFACTION_POLICY_LABELS, OPERATOR_PERMISSION_LABELS } from '@/lib/labels';
import type { EventRow, SatisfactionPolicy } from '@/types/event';
import type { OperatorPermission } from '@/types/operator';

const SATISFACTION_POLICY_OPTIONS = (
  Object.keys(SATISFACTION_POLICY_LABELS) as SatisfactionPolicy[]
).map((p) => ({ value: p, label: SATISFACTION_POLICY_LABELS[p] }));

/**
 * 관리자 추가 시 선택 가능한 권한 등급.
 * OWNER(행사 책임자)는 작성자 1인에게만 고정되므로 선택지에서 제외하고,
 * 운영 관리·현장·조회 전용만 부여 대상으로 노출한다.
 */
const ADMIN_GRADE_OPTIONS = (Object.keys(OPERATOR_PERMISSION_LABELS) as OperatorPermission[])
  .filter((p) => p !== 'OWNER')
  .map((p) => ({ value: p, label: `${OPERATOR_PERMISSION_LABELS[p]} (${p})` }));

interface EventFormModalProps {
  open: boolean;
  onClose: () => void;
  /** 지정 시 편집 모드, 미지정 시 신규 개설 모드. */
  event?: EventRow | null;
}

/**
 * 폼에서 다루는 관리자(운영자) 1명.
 * locked=true 는 작성자(OWNER)처럼 이 폼에서 변경하지 않는 행으로, 표시만 하고
 * 삭제·등급 변경 대상에서 제외한다. 그 외 행은 등급(권한)·삭제를 폼에서 편집한다.
 */
interface PendingAdmin {
  user_id: string;
  name: string;
  email: string;
  /** 부여할 권한 등급(작성자=OWNER 고정, 나머지는 운영 관리/현장/조회 전용 중 선택). */
  permission: OperatorPermission;
  locked: boolean;
  /** 잠금 행 사유 배지(작성자 등). */
  lockedLabel?: string;
}

const DEFAULT_TZ = 'Asia/Seoul';

function buildDefaults(event?: EventRow | null): EventFormValues {
  if (!event) {
    return {
      title: '',
      max_sessions_per_startup: 3,
      timezone: DEFAULT_TZ,
      allow_startup_self_booking: false,
      allow_duplicate_expert: false,
      satisfaction_policy: 'EVENT_ONLY',
      booking_start: '',
      booking_end: '',
      event_start: '',
      event_end: '',
    };
  }
  const tz = event.timezone;
  return {
    title: event.title,
    max_sessions_per_startup: event.max_sessions_per_startup,
    timezone: tz,
    allow_startup_self_booking: event.allow_startup_self_booking,
    allow_duplicate_expert: event.allow_duplicate_expert,
    satisfaction_policy: event.satisfaction_policy,
    booking_start: isoToLocalInput(event.booking_start, tz),
    booking_end: isoToLocalInput(event.booking_end, tz),
    event_start: isoToLocalInput(event.event_start, tz),
    event_end: isoToLocalInput(event.event_end, tz),
  };
}

/**
 * 행사 개설/편집 폼 (page_admin_event_list.md §2.1).
 * 날짜는 행사 timezone 벽시계로 입력받아 제출 시 UTC 로 변환한다.
 *
 * 두 섹션으로 구성한다.
 *  - 기본설정: 행사명·시간대·예약/행사 기간 + 관리자(운영자) 지정(최고관리자 전용).
 *  - 행사 설정: 상담 횟수·만족도 정책·자율예약/중복 전문가 허용.
 * 관리자 지정은 events 행이 아니라 event_operator_roles 부여라서 zod 폼 밖의 로컬 상태로
 * 다루고, 제출 시 행사 저장 후 grant/revoke 를 묶어서 처리한다(작성자=OWNER, 추가=MANAGER).
 */
export function EventFormModal({ open, onClose, event }: EventFormModalProps) {
  const isEdit = Boolean(event);
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isSuper = me?.role === 'ADMIN' && me.is_super_admin === true;

  const create = useCreateEvent();
  const update = useUpdateEvent();
  const grant = useGrantEventOperator();
  const revoke = useRevokeEventOperator();

  // 관리자 후보·현황은 최고관리자만 조회 가능(섹션 자체가 super 전용).
  const operatorsQ = useOperators();
  const assignmentsQ = useEventOperators(isSuper && open && event ? event.id : null);

  const [admins, setAdmins] = useState<PendingAdmin[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: buildDefaults(event),
  });

  // 모달이 열릴 때마다 대상 행사에 맞춰 폼을 초기화한다.
  useEffect(() => {
    if (!open) return;
    reset(buildDefaults(event));
    setAdminError(null);
    if (!isSuper) {
      setAdmins([]);
      return;
    }
    // 개설: 작성자(현재 최고관리자)를 OWNER 잠금 행으로 시드. 편집은 아래 effect 가 채운다.
    if (!event && me) {
      setAdmins([
        { user_id: me.id, name: me.name, email: me.email, permission: 'OWNER', locked: true, lockedLabel: '작성자' },
      ]);
    } else {
      setAdmins([]);
    }
  }, [open, event, isSuper, me, reset]);

  // 편집: 현재 활성 운영자 로드 시 폼 목록을 시드한다(OWNER 만 잠금, 나머지 등급은 편집 가능).
  useEffect(() => {
    if (!open || !isSuper || !event) return;
    const rows = assignmentsQ.data;
    if (!rows) return;
    setAdmins(
      rows.map((r) => ({
        user_id: r.user_id,
        name: r.operator_name,
        email: r.operator_email,
        permission: r.permission,
        locked: r.permission === 'OWNER',
        lockedLabel: r.permission === 'OWNER' ? '작성자' : undefined,
      })),
    );
  }, [open, isSuper, event, assignmentsQ.data]);

  // 후보: 활성·비최고관리자 운영자 중 이미 목록에 있는 사용자 제외.
  const adminIds = useMemo(() => new Set(admins.map((a) => a.user_id)), [admins]);
  const candidateOptions = useMemo(
    () =>
      (operatorsQ.data ?? [])
        .filter((o) => o.active && !o.is_super_admin && !adminIds.has(o.id))
        .map((o) => ({ value: o.id, label: `${o.name} (${o.email})`, keywords: o.email })),
    [operatorsQ.data, adminIds],
  );

  const addAdmin = (userId: string) => {
    const op = (operatorsQ.data ?? []).find((o) => o.id === userId);
    if (!op || adminIds.has(userId)) return;
    // 기본 등급은 운영 관리(MANAGER) — 행 우측 등급 선택으로 변경한다.
    setAdmins((prev) => [
      ...prev,
      { user_id: op.id, name: op.name, email: op.email, permission: 'MANAGER', locked: false },
    ]);
  };

  const changeGrade = (userId: string, permission: OperatorPermission) => {
    setAdmins((prev) =>
      prev.map((a) => (a.user_id === userId && !a.locked ? { ...a, permission } : a)),
    );
  };

  const removeAdmin = (userId: string) => {
    setAdmins((prev) => prev.filter((a) => a.user_id !== userId || a.locked));
  };

  const submitError = create.error ?? update.error;
  const pending =
    create.isPending || update.isPending || grant.isPending || revoke.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setAdminError(null);
    // 편집 가능한 관리자(작성자=OWNER 제외)와 그 등급.
    const desiredAdmins = admins.filter((a) => !a.locked);

    try {
      if (isEdit && event) {
        await update.mutateAsync({ id: event.id, values });

        if (isSuper) {
          // 현재 부여된 비-OWNER 권한(등급 변경/회수 비교 대상).
          const currentByUser = new Map(
            (assignmentsQ.data ?? [])
              .filter((r) => r.permission !== 'OWNER')
              .map((r) => [r.user_id, r.permission] as const),
          );
          const desiredSet = new Set(desiredAdmins.map((a) => a.user_id));

          // 신규 부여 + 등급 변경(grant 가 upsert 라 동일 호출로 처리).
          const toGrant = desiredAdmins.filter(
            (a) => currentByUser.get(a.user_id) !== a.permission,
          );
          const toRevoke = [...currentByUser.keys()].filter((id) => !desiredSet.has(id));

          const results = await Promise.allSettled([
            ...toGrant.map((a) =>
              grant.mutateAsync({
                event_id: event.id,
                user_id: a.user_id,
                permission: a.permission,
                reason: '행사 편집에서 관리자 등급 지정',
              }),
            ),
            ...toRevoke.map((id) =>
              revoke.mutateAsync({
                event_id: event.id,
                user_id: id,
                reason: '행사 편집에서 관리자 제외',
              }),
            ),
          ]);
          qc.invalidateQueries({ queryKey: ['my-event-roles'] });
          if (results.some((r) => r.status === 'rejected')) {
            setAdminError('행사는 저장되었으나 일부 관리자 변경에 실패했습니다. 행사 상세의 운영자 배정에서 다시 시도해 주세요.');
            return;
          }
        }
      } else {
        const { id } = await create.mutateAsync(values);

        if (isSuper && me) {
          const results = await Promise.allSettled([
            grant.mutateAsync({
              event_id: id,
              user_id: me.id,
              permission: 'OWNER',
              reason: '행사 개설 시 작성자 지정',
            }),
            ...desiredAdmins.map((a) =>
              grant.mutateAsync({
                event_id: id,
                user_id: a.user_id,
                permission: a.permission,
                reason: '행사 개설 시 관리자 지정',
              }),
            ),
          ]);
          qc.invalidateQueries({ queryKey: ['my-event-roles'] });
          if (results.some((r) => r.status === 'rejected')) {
            setAdminError('행사는 생성되었으나 일부 관리자 권한 부여에 실패했습니다. 행사 상세의 운영자 배정에서 다시 시도해 주세요.');
            return;
          }
        }
      }
      onClose();
    } catch {
      // create/update 실패는 submitError 로 노출(아래 폼 상단 Alert).
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '행사 편집' : '새 행사 개설'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button type="submit" form="event-form" loading={pending}>
            {isEdit ? '저장' : '개설'}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {submitError && <Alert tone="error">{(submitError as Error).message}</Alert>}
        {adminError && <Alert tone="error">{adminError}</Alert>}

        {/* ───────── 기본설정 ───────── */}
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-bold text-neutral-base">기본설정</h3>

          <TextField
            label="행사명"
            placeholder="예: 2026 상반기 비즈니스 매칭 데이"
            error={errors.title?.message}
            {...register('title')}
          />

          <SelectField
            label="시간대"
            options={TIMEZONE_OPTIONS}
            error={errors.timezone?.message}
            {...register('timezone')}
          />

          <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-neutral-base">예약 기간</legend>
            <TextField
              label="예약 시작"
              type="datetime-local"
              error={errors.booking_start?.message}
              {...register('booking_start')}
            />
            <TextField
              label="예약 마감"
              type="datetime-local"
              error={errors.booking_end?.message}
              {...register('booking_end')}
            />
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-neutral-base">행사 진행 기간</legend>
            <TextField
              label="행사 시작"
              type="datetime-local"
              error={errors.event_start?.message}
              {...register('event_start')}
            />
            <TextField
              label="행사 종료"
              type="datetime-local"
              error={errors.event_end?.message}
              {...register('event_end')}
            />
          </fieldset>

          {/* 관리자(운영자) 지정 — 최고관리자 전용. */}
          {isSuper && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-neutral-base">관리자</p>
              <p className="text-xs text-neutral-base/60">
                이 행사를 관리할 운영자를 추가하고 권한 등급을 지정합니다. 작성자는 행사 책임자로 항상
                포함되며 제외할 수 없습니다.
              </p>
              <SearchableSelect
                options={candidateOptions}
                value={null}
                onChange={(id) => id && addAdmin(id)}
                placeholder="관리자 추가"
                searchPlaceholder="이름·이메일 검색"
                emptyMessage="추가할 운영자가 없습니다."
              />
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {admins.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-neutral-base/60">지정된 관리자가 없습니다.</li>
                ) : (
                  admins.map((a) => (
                    <li key={a.user_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-base">
                          {a.name}
                          {a.lockedLabel && (
                            <span className="ml-2 rounded bg-info-surface px-1.5 py-0.5 text-[11px] font-medium text-neutral-base/70">
                              {a.lockedLabel}
                            </span>
                          )}
                        </p>
                        {a.email && <span className="text-xs text-neutral-base/70">{a.email}</span>}
                      </div>
                      {a.locked ? (
                        <span className="shrink-0 text-xs text-neutral-base/50">
                          {OPERATOR_PERMISSION_LABELS[a.permission]} · 고정
                        </span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2">
                          <select
                            value={a.permission}
                            onChange={(e) => changeGrade(a.user_id, e.target.value as OperatorPermission)}
                            aria-label="권한 등급"
                            className="rounded-md border border-border bg-white px-2 py-1 text-xs font-medium text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
                          >
                            {ADMIN_GRADE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            onClick={() => removeAdmin(a.user_id)}
                            variant="outline"
                            size="sm"
                            className="text-brand"
                          >
                            삭제
                          </Button>
                        </div>
                      )}
                    </li>
                  ))
                )}
              </ul>
              {operatorsQ.isError && (
                <Alert tone="error">운영자 목록을 불러오지 못했습니다.</Alert>
              )}
            </div>
          )}
        </section>

        {/* ───────── 행사 설정 ───────── */}
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-bold text-neutral-base">행사 설정</h3>

          <TextField
            label="스타트업당 최대 상담 횟수"
            type="number"
            min={1}
            error={errors.max_sessions_per_startup?.message}
            {...register('max_sessions_per_startup')}
          />

          <div>
            <SelectField
              label="만족도 수집 정책"
              options={SATISFACTION_POLICY_OPTIONS}
              error={errors.satisfaction_policy?.message}
              {...register('satisfaction_policy')}
            />
            <p className="mt-1 text-xs text-neutral-base/60">
              종료 후 수집할 만족도 단위를 정합니다. 전문가별 만족도 수집·집계는 순차 제공됩니다.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-neutral-base">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
              {...register('allow_startup_self_booking')}
            />
            배치 조율·진행 단계에서도 스타트업 자율 예약(변경·취소) 허용
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-neutral-base">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
              {...register('allow_duplicate_expert')}
            />
            동일 전문가와 2회 이상(연속 시간 등) 예약 허용
          </label>
        </section>
      </form>
    </Modal>
  );
}
