import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  otpRequestSchema,
  otpVerifySchema,
  type OtpRequestInput,
  type OtpVerifyInput,
} from '@/schemas/authSchemas';
import { useAuthStore, AuthError } from '@/stores/authStore';
import type { AppUser } from '@/types/auth';
import { TextField } from '@/components/common/TextField';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';

const GENERIC_SENT = '등록된 연락처가 확인되면 인증번호를 발송했습니다. 메일함 또는 문자를 확인해 주세요.';
const NETWORK_ERR = '네트워크 연결 상태를 확인하고 다시 시도해 주세요.';
const OTP_ERR = '인증번호가 올바르지 않거나 만료되었습니다. 새 인증번호를 요청해 주세요.';

/**
 * 전문가/스타트업 OTP 로그인 (page_auth_layout.md §1.2~1.4).
 * 1단계: 등록 이메일/휴대전화 → 인증번호 요청. 2단계: 6자리 인증번호 검증.
 * 두 역할 모두 동일 흐름이며 식별자 안내 문구만 다르다. 계정 존재 여부는 노출하지 않는다.
 */
export function ParticipantLoginForm({
  role,
  onSuccess,
}: {
  role: 'STARTUP' | 'EXPERT';
  onSuccess: (user: AppUser) => void;
}) {
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);

  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [identifier, setIdentifier] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // 재요청 쿨다운 카운트다운(60초). step/cooldown 변화 시 1초 간격으로 감소.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [cooldown]);

  const requestForm = useForm<OtpRequestInput>({ resolver: zodResolver(otpRequestSchema) });
  const verifyForm = useForm<OtpVerifyInput>({ resolver: zodResolver(otpVerifySchema) });

  const placeholder =
    role === 'STARTUP' ? '회사 이메일 또는 휴대전화' : '이메일 또는 휴대전화';

  const sendOtp = async (value: string): Promise<boolean> => {
    setFormError(null);
    try {
      const res = await requestOtp(value);
      setCooldown(res.retry_after > 0 ? res.retry_after : 60);
      return true;
    } catch {
      // OTP 요청은 계정 존재 여부와 무관하게 generic 200 → 던져진 오류는 네트워크/서버뿐.
      setFormError(NETWORK_ERR);
      return false;
    }
  };

  const onRequest = async (values: OtpRequestInput) => {
    const ok = await sendOtp(values.identifier);
    if (ok) {
      setIdentifier(values.identifier);
      setStep('verify');
      verifyForm.reset();
    }
  };

  const onVerify = async (values: OtpVerifyInput) => {
    setFormError(null);
    try {
      const user = await verifyOtp(identifier, values.code);
      onSuccess(user);
    } catch (e) {
      const err = e as AuthError;
      setFormError(err.kind === 'network' ? NETWORK_ERR : OTP_ERR);
    }
  };

  const onResend = async () => {
    if (cooldown > 0) return;
    await sendOtp(identifier);
    verifyForm.reset();
  };

  const backToRequest = () => {
    setStep('request');
    setFormError(null);
    setCooldown(0);
  };

  if (step === 'request') {
    return (
      <form onSubmit={requestForm.handleSubmit(onRequest)} className="flex flex-col gap-4">
        <TextField
          label="등록 이메일 또는 휴대전화"
          autoComplete="username"
          placeholder={placeholder}
          error={requestForm.formState.errors.identifier?.message}
          {...requestForm.register('identifier')}
        />
        {formError && <Alert tone="error">{formError}</Alert>}
        <Button type="submit" loading={requestForm.formState.isSubmitting} className="w-full">
          인증번호 받기
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyForm.handleSubmit(onVerify)} className="flex flex-col gap-4">
      <Alert tone="info">{GENERIC_SENT}</Alert>
      <TextField
        label="인증번호 6자리"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="예: 123456"
        error={verifyForm.formState.errors.code?.message}
        {...verifyForm.register('code')}
      />
      {formError && <Alert tone="error">{formError}</Alert>}
      <Button type="submit" loading={verifyForm.formState.isSubmitting} className="w-full">
        로그인
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={backToRequest}
          className="font-semibold text-neutral-base underline hover:text-brand"
        >
          연락처 다시 입력
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={cooldown > 0}
          className="font-semibold text-neutral-base underline hover:text-brand disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        >
          {cooldown > 0 ? `인증번호 재발송 (${cooldown}초)` : '인증번호 재발송'}
        </button>
      </div>
    </form>
  );
}
