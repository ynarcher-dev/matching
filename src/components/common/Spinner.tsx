/** 로딩 스피너 (인라인 스타일 금지 — Tailwind animate-spin). */
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="로딩 중"
      className={`inline-block animate-spin rounded-full border-2 border-white border-t-transparent ${className}`}
    />
  );
}
