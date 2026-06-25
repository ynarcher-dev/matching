import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { homePathFor } from '@/lib/navigation';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Spinner } from '@/components/common/Spinner';

type Phase = 'loading' | 'error';

/**
 * 현장 예외용 1회용 로그인 링크 진입점 (`/login/emergency?token=...`).
 * 관리자가 발급한 토큰을 소비해 참가자 세션을 설정하고 역할 홈으로 보낸다.
 * 토큰은 1회용이라 컴포넌트 재마운트(StrictMode) 시 중복 소비를 ref 로 막는다.
 */
export function EmergencyLoginView() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const consumeEmergencyToken = useAuthStore((s) => s.consumeEmergencyToken);

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setPhase('error');
      setMessage('로그인 링크가 올바르지 않습니다.');
      return;
    }

    consumeEmergencyToken(token)
      .then((user) => navigate(homePathFor(user.role), { replace: true }))
      .catch((e: Error) => {
        setPhase('error');
        setMessage(e.message || '로그인 링크 처리 중 문제가 발생했습니다.');
      });
  }, [token, consumeEmergencyToken, navigate]);

  if (phase === 'loading') {
    return (
      <Centered>
        <Spinner className="h-6 w-6" />
        <p className="text-sm text-neutral-base">로그인 링크를 확인하는 중입니다…</p>
      </Centered>
    );
  }

  return (
    <Centered>
      <Alert tone="error">{message}</Alert>
      <p className="text-sm text-neutral-base/70">
        링크가 만료되었거나 이미 사용되었을 수 있습니다. 운영본부에 재발급을 요청하거나 로그인
        화면에서 인증번호로 로그인해 주세요.
      </p>
      <GoToLogin />
    </Centered>
  );
}

/** 이미 로그인된 상태에서 직접 접근 시 로그인 화면 링크. */
function GoToLogin() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  if (status === 'authenticated' && user) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }
  return (
    <a
      href="/login"
      className="rounded-lg bg-brand px-4 py-2 text-base font-semibold text-white transition-colors hover:bg-brand-hover"
    >
      로그인 화면으로
    </a>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Card className="flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
        {children}
      </Card>
    </div>
  );
}
