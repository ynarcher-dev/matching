import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { homePathFor } from '@/lib/navigation';
import { RequireAuth, RequireRole } from '@/routes/guards';
import { AppShell } from '@/components/common/AppShell';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { LoginView } from '@/views/LoginView';
import { EmergencyLoginView } from '@/views/EmergencyLoginView';
import { NotFoundView } from '@/views/NotFoundView';
import { PlaceholderView } from '@/views/common/PlaceholderView';
import { EventListView } from '@/views/admin/EventListView';
import { EventDetailView } from '@/views/admin/EventDetailView';
import { UserListView } from '@/views/admin/UserListView';

/**
 * 라우트 정의 (page_auth_layout.md §1.3 역할별 진입 + §2.4 메뉴).
 * RequireAuth(인증) → AppShell(공통 레이아웃) → RequireRole(역할) 중첩.
 * 각 역할 페이지 본문은 Phase 4~6 에서 PlaceholderView 를 대체한다.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginView />} />
      <Route path="/login/emergency" element={<EmergencyLoginView />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {/* 관리자 */}
          <Route element={<RequireRole allow={['ADMIN']} />}>
            <Route path="/admin/events" element={<EventListView />} />
            <Route path="/admin/events/:eventId" element={<EventDetailView />} />
            <Route
              path="/admin/events/:eventId/ai-allocation"
              element={
                <PlaceholderView
                  title="AI 자동배치"
                  description="슬롯 자동 생성·AI 매칭 제안·확정 — 다음 슬라이스에서 구현."
                />
              }
            />
            <Route path="/admin/users" element={<UserListView />} />
            <Route
              path="/admin/settings"
              element={<PlaceholderView title="설정" description="운영 환경 설정." />}
            />
          </Route>

          {/* 현장 스태프 */}
          <Route element={<RequireRole allow={['STAFF']} />}>
            <Route
              path="/staff/check-in"
              element={<PlaceholderView title="출석 체크" description="현장 출석 처리(원클릭·QR 보조)." />}
            />
          </Route>

          {/* 전문가 */}
          <Route element={<RequireRole allow={['EXPERT']} />}>
            <Route
              path="/expert/dashboard"
              element={<PlaceholderView title="오늘의 스케줄" description="본인 상담 시간표 및 진행." />}
            />
            <Route
              path="/expert/history"
              element={<PlaceholderView title="이전 상담 이력" description="과거 상담일지 조회." />}
            />
          </Route>

          {/* 스타트업 */}
          <Route element={<RequireRole allow={['STARTUP']} />}>
            <Route
              path="/startup/booking"
              element={<PlaceholderView title="내 예약 관리" description="전문가 조회 및 예약/변경/취소." />}
            />
            <Route
              path="/startup/notices"
              element={<PlaceholderView title="안내 사항" description="행사 안내 및 공지." />}
            />
          </Route>
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<NotFoundView />} />
    </Routes>
  );
}

/** 루트 진입: 인증 상태에 따라 역할 홈 또는 로그인으로 보낸다. */
function RootRedirect() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated' && user) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }
  return <Navigate to="/login" replace />;
}
