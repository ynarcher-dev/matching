interface TableTagProps {
  /** 테이블 코드(예: F-01). */
  code: string;
  className?: string;
}

/**
 * 배정 테이블 코드 태그(진한 면 + 흰 글씨).
 * 예약 일정표(시간대별·전문가별)·나의 매칭 예약·관리자 진행/예약 그리드에서 동일 형태로 쓴다.
 */
export function TableTag({ code, className = '' }: TableTagProps) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded bg-neutral-base px-2 py-0.5 text-xs font-bold text-white ${className}`}
    >
      {code}
    </span>
  );
}
