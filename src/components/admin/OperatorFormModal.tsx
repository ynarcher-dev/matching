import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { TextField } from '@/components/common/TextField';
import { SelectField } from '@/components/common/SelectField';
import { operatorFormSchema } from '@/schemas/operatorSchemas';
import type { OperatorFormValues } from '@/schemas/operatorSchemas';
import { useCreateOperator, useUpdateOperator } from '@/hooks/useOperatorMutations';
import { toast } from '@/stores/toastStore';
import { OPERATOR_ROLE_LABELS } from '@/lib/labels';
import type { Operator, OperatorSecretResult } from '@/types/operator';

interface OperatorFormModalProps {
  open: boolean;
  onClose: () => void;
  /** 지정 시 수정 모드, 미지정 시 신규 생성. */
  operator?: Operator | null;
  /** 생성 성공 시 임시 비밀번호/링크 결과를 부모로 전달(1회 노출 모달). */
  onCreated: (result: OperatorSecretResult, email: string) => void;
}

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: OPERATOR_ROLE_LABELS.ADMIN },
  { value: 'STAFF', label: OPERATOR_ROLE_LABELS.STAFF },
];

const PASSWORD_MODE_OPTIONS = [
  { value: 'temp_password', label: '임시 비밀번호 생성(즉시 1회 표시)' },
  { value: 'invite', label: '비밀번호 설정 링크 발급' },
];

function buildDefaults(operator: Operator | null | undefined): OperatorFormValues {
  return {
    email: operator?.email ?? '',
    name: operator?.name ?? '',
    role: operator?.role ?? 'STAFF',
    is_super_admin: operator?.is_super_admin ?? false,
    password_mode: 'temp_password',
    reason: '',
  };
}

/**
 * 운영자 생성/수정 모달 (page_admin_operator_permissions.md 4.2).
 * 생성: 이메일·이름·역할·최고관리자·비밀번호 방식·사유. 수정: 이메일 고정, 나머지 변경.
 */
export function OperatorFormModal({ open, onClose, operator, onCreated }: OperatorFormModalProps) {
  const isEdit = Boolean(operator);
  const create = useCreateOperator();
  const update = useUpdateOperator();
  const pending = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<OperatorFormValues>({
    resolver: zodResolver(operatorFormSchema),
    defaultValues: buildDefaults(operator),
  });

  useEffect(() => {
    if (open) {
      reset(buildDefaults(operator));
      create.reset();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, operator]);

  const role = watch('role');

  const onSubmit = handleSubmit((values) => {
    if (isEdit && operator) {
      update.mutate(
        {
          user_id: operator.id,
          name: values.name,
          role: values.role,
          is_super_admin: values.is_super_admin,
          active: operator.active,
          reason: values.reason,
        },
        {
          onSuccess: () => {
            onClose();
            toast.success('운영자 정보를 저장했습니다.');
          },
          onError: (e) =>
            toast.error('운영자 정보를 저장하지 못했습니다.', { description: (e as Error).message }),
        },
      );
    } else {
      create.mutate(
        {
          email: values.email,
          name: values.name,
          role: values.role,
          is_super_admin: values.is_super_admin,
          send_invite: values.password_mode === 'invite',
          reason: values.reason,
        },
        {
          onSuccess: (result) => {
            // 생성 결과(임시 비번/링크)는 1회 노출 SecretModal 이 중심이라 성공 Toast 는 생략.
            onClose();
            onCreated(result, values.email);
          },
          onError: (e) =>
            toast.error('운영자를 생성하지 못했습니다.', { description: (e as Error).message }),
        },
      );
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '운영자 정보 수정' : '운영자 추가'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button type="submit" form="operator-form" loading={pending}>
            {isEdit ? '저장' : '생성'}
          </Button>
        </>
      }
    >
      <form id="operator-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="이메일(로그인 ID)"
          type="email"
          placeholder="operator@example.com"
          error={errors.email?.message}
          disabled={isEdit}
          {...register('email')}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="이름" error={errors.name?.message} {...register('name')} />
          <SelectField label="역할" options={ROLE_OPTIONS} error={errors.role?.message} {...register('role')} />
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand"
            disabled={role !== 'ADMIN'}
            {...register('is_super_admin')}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-neutral-base">최고관리자 권한 부여</span>
            <span className="text-xs text-neutral-base/70">
              전체 행사·운영자 계정·전역 설정에 접근합니다. 관리자(ADMIN) 역할에만 부여할 수 있습니다.
            </span>
            {errors.is_super_admin?.message && (
              <span className="text-xs font-medium text-brand">{errors.is_super_admin.message}</span>
            )}
          </span>
        </label>

        {!isEdit && (
          <SelectField
            label="비밀번호 전달 방식"
            options={PASSWORD_MODE_OPTIONS}
            error={errors.password_mode?.message}
            {...register('password_mode')}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="operator-reason" className="text-sm font-semibold text-neutral-base">
            감사 사유
          </label>
          <textarea
            id="operator-reason"
            rows={2}
            placeholder="예: 신규 행사 운영 담당자 추가"
            className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
              errors.reason ? 'border-brand' : 'border-border'
            }`}
            {...register('reason')}
          />
          {errors.reason?.message && (
            <p className="text-sm font-medium text-brand">{errors.reason.message}</p>
          )}
        </div>
      </form>
    </Modal>
  );
}
