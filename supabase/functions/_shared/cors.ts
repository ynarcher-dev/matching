// 공통 CORS 헤더 + 프리플라이트 핸들러 (Edge Functions 공용).
// 운영 배포 시 ALLOWED_ORIGIN 시크릿으로 출처를 좁히는 것을 권장한다.
export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-dispatch-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
