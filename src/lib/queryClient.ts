import { QueryClient } from '@tanstack/react-query';

// 공통 React Query 클라이언트 (yna-db 패턴 채택).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
