/** 선택 체크박스 시각 표시(목록 좌측·전체 선택 헤더 공통). */
export function SelectBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
        checked ? 'border-neutral-base bg-neutral-base text-white' : 'border-border bg-surface-raised'
      }`}
      aria-hidden
    >
      {checked ? '✓' : ''}
    </span>
  );
}
