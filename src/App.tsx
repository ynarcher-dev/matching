import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/stores/authStore';

/**
 * 애플리케이션 루트.
 * Provider 순서: React Query → 라우터.
 * 마운트 시 저장된 세션/토큰을 검증(bootstrap)해 인증 상태를 확정한다.
 */
export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
