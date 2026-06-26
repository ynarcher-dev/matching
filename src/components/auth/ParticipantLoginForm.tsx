import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  participantLoginSchema,
  type ParticipantLoginInput,
} from '@/schemas/authSchemas';
import { useAuthStore, AuthError } from '@/stores/authStore';
import type { AppUser } from '@/types/auth';
import { TextField } from '@/components/common/TextField';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';

const NETWORK_ERR = '네트워크 연결 상태를 확인하고 다시 시도해 주세요.';
const MISMATCH_ERR = '이름 또는 휴대전화 번호가 등록 정보와 일치하지 않습니다. 운영본부에 문의해 주세요.';

/**
 * 전문가/스타트업 로그인 (page_auth_layout.md §1, free_login_transition.md).
 * 외부 발송에 의존하지 않는 무료 운영 전환: 등록된 이름 + 휴대전화번호 정확일치로 로그인한다.
 * 두 역할 모두 동일 흐름이며 안내 문구만 다르다. 계정 존재 여부는 노출하지 않는다.
 */
export function ParticipantLoginForm({
  onSuccess,
}: {
  onSuccess: (user: AppUser) => void;
}) {
  const loginParticipant = useAuthStore((s) => s.loginParticipant);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ParticipantLoginInput>({ resolver: zodResolver(participantLoginSchema) });

  const onSubmit = async (values: ParticipantLoginInput) => {
    setFormError(null);
    try {
      const user = await loginParticipant(values.name, values.phone);
      onSuccess(user);
    } catch (e) {
      const err = e as AuthError;
      setFormError(err.kind === 'network' ? NETWORK_ERR : (err.message || MISMATCH_ERR));
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <TextField
        label="이름"
        autoComplete="name"
        placeholder="예: 홍길동"
        error={form.formState.errors.name?.message}
        {...form.register('name')}
      />
      <TextField
        label="휴대전화 번호"
        inputMode="tel"
        autoComplete="tel"
        placeholder="예: 010-1234-5678"
        error={form.formState.errors.phone?.message}
        {...form.register('phone')}
      />
      {formError && <Alert tone="error">{formError}</Alert>}
      <Button type="submit" loading={form.formState.isSubmitting} className="w-full">
        로그인
      </Button>
    </form>
  );
}
