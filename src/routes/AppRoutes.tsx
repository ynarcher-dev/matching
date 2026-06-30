import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { homePathFor } from '@/lib/navigation';
import { RequireAuth, RequireRole, RequireSuperAdmin } from '@/routes/guards';
import { AppShell } from '@/components/common/AppShell';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { LoginView } from '@/views/LoginView';
import { EmergencyLoginView } from '@/views/EmergencyLoginView';
import { NotFoundView } from '@/views/NotFoundView';
import { PlaceholderView } from '@/views/common/PlaceholderView';
import { EventListView } from '@/views/admin/EventListView';
import { EventDetailView } from '@/views/admin/EventDetailView';
import { AiAllocationView } from '@/views/admin/AiAllocationView';
import { ParticipantDbView } from '@/views/admin/ParticipantDbView';
import { StartupPortalView } from '@/views/startup/StartupPortalView';
import { ExpertDashboardView } from '@/views/expert/ExpertDashboardView';
import { ExpertHistoryView } from '@/views/expert/ExpertHistoryView';
import { StaffPhotosView } from '@/views/staff/StaffPhotosView';
import { NotificationSettingsView } from '@/views/admin/NotificationSettingsView';
import { OperatorListView } from '@/views/admin/OperatorListView';

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
          {/* 관리자 (행사 범위 — 일반 운영자는 배정 행사만 RLS 로 자동 제한) */}
          <Route element={<RequireRole allow={['ADMIN']} />}>
            <Route path="/admin/events" element={<EventListView />} />
            <Route path="/admin/events/:eventId" element={<EventDetailView />} />
            <Route
              path="/admin/events/:eventId/ai-allocation"
              element={<AiAllocationView />}
            />
          </Route>

          {/* 최고관리자 전용 (전역 스타트업/전문가 DB·전역 안내발송·운영자 관리) */}
          <Route element={<RequireSuperAdmin />}>
            <Route path="/admin/startups" element={<ParticipantDbView role="STARTUP" />} />
            <Route path="/admin/experts" element={<ParticipantDbView role="EXPERT" />} />
            {/* 구 경로 호환: 분리 전 참가자 DB → 스타트업 DB 로 이관 */}
            <Route path="/admin/users" element={<Navigate to="/admin/startups" replace />} />
            <Route path="/admin/settings" element={<NotificationSettingsView />} />
            <Route path="/admin/operators" element={<OperatorListView />} />
          </Route>

          {/* 현장 스태프 */}
          <Route element={<RequireRole allow={['STAFF']} />}>
            <Route
              path="/staff/check-in"
              element={<PlaceholderView title="출석 체크" description="현장 출석 처리(원클릭·QR 보조)." />}
            />
            <Route path="/staff/photos" element={<StaffPhotosView />} />
          </Route>

          {/* 전문가 */}
          <Route element={<RequireRole allow={['EXPERT']} />}>
            <Route path="/expert/dashboard" element={<ExpertDashboardView />} />
            <Route path="/expert/history" element={<ExpertHistoryView />} />
          </Route>

          {/* 스타트업 */}
          <Route element={<RequireRole allow={['STARTUP']} />}>
            <Route path="/startup/booking" element={<StartupPortalView />} />
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
