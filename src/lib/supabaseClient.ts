import { createClient } from '@supabase/supabase-js';

/**
 * Supabase 클라이언트 (dev_conventions.md — 환경변수 완벽 격리).
 * 자격증명은 .env.local 의 VITE_ 변수에서만 주입하며 하드코딩하지 않는다.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // 빌드/런타임에서 환경변수 누락을 조기에 드러낸다.
  console.error(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요.',
  );
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
