import type { CounselingLogRow } from '@/types/expert';
import type { CounselingAnswerRow, CounselingQuestion } from '@/types/counselingLog';

/**
 * 상담일지 읽기 전용 요약 (이전 상담 이력 카드 본문).
 * 출처: docs/counseling_log_customization.md §8.1.
 * 동적 문항(RATING/객관식/주관식) + 후속 연계 + 공개 여부 배지를 렌더링한다.
 * 점수·구조화 답변은 항상 비공개(관리자 전용)이나 작성 전문가 본인 화면이므로 함께 표시한다.
 */
export function CounselingLogSummary({
  log,
  questions,
  answers,
}: {
  log: CounselingLogRow | null;
  questions: CounselingQuestion[];
  answers: CounselingAnswerRow[];
}) {
  if (!log) {
    return <p className="text-sm text-neutral-base/50">작성된 상담일지가 없습니다.</p>;
  }

  const answerByQ = new Map(answers.map((a) => [a.question_id, a]));
  const ordered = [...questions].sort((a, b) => a.order_no - b.order_no);
  const ratings = ordered.filter((q) => q.question_type === 'RATING');
  const others = ordered.filter((q) => q.question_type !== 'RATING');

  const displayValue = (q: CounselingQuestion): string => {
    const a = answerByQ.get(q.id);
    if (!a) return '–';
    if (q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTIPLE_CHOICE') {
      return a.answer_selections && a.answer_selections.length > 0
        ? a.answer_selections.join(', ')
        : '–';
    }
    return a.answer_text?.trim() ? a.answer_text : '–';
  };

  return (
    <div className="flex flex-col gap-3">
      {ratings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ratings.map((q) => (
            <span
              key={q.id}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-neutral-base"
            >
              {q.title}
              <span className="font-bold text-brand">{answerByQ.get(q.id)?.answer_rating ?? '–'}</span>
            </span>
          ))}
        </div>
      )}

      {others.map((q) => (
        <div key={q.id} className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-neutral-base/70">{q.title}</span>
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-white px-3 py-2 text-sm text-neutral-base/90">
            {displayValue(q)}
          </p>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 text-xs">
        {log.follow_up_required && (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 font-semibold text-brand">
            후속 연계 요청
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            log.is_public ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-neutral-base/60'
          }`}
        >
          의견 {log.is_public ? '공개' : '비공개'}
        </span>
      </div>

      {log.follow_up_required && log.follow_up_memo && (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-neutral-base/80">
          후속 메모: {log.follow_up_memo}
        </p>
      )}
    </div>
  );
}
