import type { ReactNode } from 'react';

interface ValidationSummaryProps {
  /** 오류 문구 목록. 비어 있으면 아무것도 렌더하지 않는다. */
  errors: ReactNode[];
  /** 목록 위에 붙는 제목. 기본값 제공. */
  title?: string;
  className?: string;
}

/**
 * 폼 제출 전 검증 오류를 한데 모아 보여주는 요약 박스 (ui_feedback_message_audit §7.3).
 * 필드 단위 오류는 각 입력 아래 인라인으로 두고, 여기서는 "제출을 막은 이유"들을
 * 폼 하단/상단에 목록으로 묶는다. 클릭 액션 실패(서버 에러)는 Toast 를 쓴다.
 */
export function ValidationSummary({
  errors,
  title = '입력을 확인해 주세요',
  className = '',
}: ValidationSummaryProps) {
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      className={`rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-brand ${className}`}
    >
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
