import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { operatorLoginSchema, type OperatorLoginInput } from '@/schemas/authSchemas';
import { useAuthStore, AuthError } from '@/stores/authStore';
import type { AppUser } from '@/types/auth';
import { TextField } from '@/components/common/TextField';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';

/** 운영진(ADMIN/STAFF) Supabase Auth 로그인 (page_auth_layout.md §1.2~1.3). */
export function OperatorLoginForm({ onSuccess }: { onSuccess: (user: AppUser) => void }) {
  const loginOperator = useAuthStore((s) => s.loginOperator);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OperatorLoginInput>({ resolver: zodResolver(operatorLoginSchema) });

  const onSubmit = async (values: OperatorLoginInput) => {
    setFormError(null);
    try {
      const user = await loginOperator(values.email, values.password);
      onSuccess(user);
    } catch (e) {
      const err = e as AuthError;
      if (err.kind === 'network') {
        setFormError('네트워크 연결 상태를 확인하고 다시 시도해 주세요.');
      } else if (err.kind === 'forbidden') {
        setFormError('운영진 전용 로그인입니다. 참가자는 인증번호 탭을 이용해 주세요.');
      } else {
        setFormError('이메일 또는 비밀번호가 일치하지 않습니다.');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <TextField
        label="이메일 주소"
        type="email"
        autoComplete="email"
        placeholder="operator@ynarcher.com"
        error={errors.email?.message}
        {...register('email')}
      />
      <TextField
        label="비밀번호"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      {formError && <Alert tone="error">{formError}</Alert>}
      <Button type="submit" loading={isSubmitting} className="w-full">
        로그인
      </Button>
    </form>
  );
}
