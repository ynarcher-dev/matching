import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { homePathFor } from '@/lib/navigation';
import type { AppUser } from '@/types/auth';
import { RoleTabs, type LoginTab } from '@/components/auth/RoleTabs';
import { ParticipantLoginForm } from '@/components/auth/ParticipantLoginForm';
import { OperatorLoginForm } from '@/components/auth/OperatorLoginForm';
import { Card } from '@/components/common/Card';

const TAB_GUIDE: Record<LoginTab, string> = {
  STARTUP: '등록한 이름과 휴대전화 번호로 로그인하세요.',
  EXPERT: '등록한 이름과 휴대전화 번호로 로그인하세요.',
  OPERATOR: '운영진 이메일과 비밀번호로 로그인하세요.',
};

/** 공통 로그인 관문 (page_auth_layout.md §1). */
export function LoginView() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [tab, setTab] = useState<LoginTab>('STARTUP');

  // 이미 로그인된 사용자가 /login 으로 오면 역할 홈으로 보낸다.
  if (status === 'authenticated' && user) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  const onSuccess = (loggedIn: AppUser) => {
    navigate(homePathFor(loggedIn.role), { replace: true });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <span className="inline-block rounded-lg bg-brand px-3 py-1 text-lg font-bold text-white">
            YNA
          </span>
          <h1 className="mt-3 text-2xl font-bold text-neutral-base">비즈니스 매칭</h1>
          <p className="mt-1 text-sm text-neutral-base">행사 운영·상담 매칭 시스템</p>
        </header>

        <Card className="p-5">
          <RoleTabs active={tab} onChange={setTab} />
          <p className="mb-4 mt-3 text-sm text-neutral-base">{TAB_GUIDE[tab]}</p>

          {tab === 'OPERATOR' ? (
            <OperatorLoginForm onSuccess={onSuccess} />
          ) : (
            <ParticipantLoginForm key={tab} onSuccess={onSuccess} />
          )}
        </Card>

        <p className="mt-4 text-center text-xs text-neutral-base">
          로그인에 문제가 있으면 운영본부(관리자)에 문의해 주세요.
        </p>
      </div>
    </main>
  );
}
