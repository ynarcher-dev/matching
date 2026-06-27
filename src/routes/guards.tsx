import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { homePathFor } from '@/lib/navigation';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import type { AppRole } from '@/types/auth';

/**
 * 인증 가드. 부트스트랩 중에는 로더, 미인증은 /login 으로.
 * (dev_conventions.md — RequireAuth → RequireRole 중첩 패턴)
 */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') return <FullScreenLoader />;
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** 역할 가드. 허용 역할이 아니면 본인 역할 홈으로 돌려보낸다. */
export function RequireRole({ allow }: { allow: AppRole[] }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return <Outlet />;
}

/** 최고관리자 전용 가드(운영자 관리·전역 권한). 아니면 본인 역할 홈으로. */
export function RequireSuperAdmin() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN' || !user.is_super_admin) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }
  return <Outlet />;
}
