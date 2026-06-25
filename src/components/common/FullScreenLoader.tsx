/** 세션 부트스트랩 중 전체 화면 로더. */
export function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <span
        role="status"
        aria-label="로딩 중"
        className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-neutral-base border-t-brand"
      />
    </div>
  );
}
