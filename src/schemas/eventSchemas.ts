import { z } from 'zod';

/**
 * 행사 개설/편집 폼 검증 (page_admin_event_list.md §2.1, db_schema.md §3 CHECK 정합).
 * 날짜 값은 `datetime-local`(벽시계, 'YYYY-MM-DDTHH:mm') 문자열로 다룬다.
 * 동일 타임존 내 비교이므로 사전식 문자열 비교로 선후 관계를 검증할 수 있다.
 * 실제 timestamptz 변환은 제출 시 lib/datetime.localInputToIso 가 담당한다.
 */
export const eventFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, '행사명을 입력해 주세요.')
      .max(255, '행사명은 255자 이하여야 합니다.'),
    max_sessions_per_startup: z.coerce
      .number({ invalid_type_error: '숫자를 입력해 주세요.' })
      .int('정수를 입력해 주세요.')
      .min(1, '최소 1회 이상이어야 합니다.')
      .max(99, '99회 이하로 설정해 주세요.'),
    timezone: z.string().min(1, '시간대를 선택해 주세요.'),
    allow_startup_self_booking: z.boolean(),
    booking_start: z.string().min(1, '예약 시작 일시를 입력해 주세요.'),
    booking_end: z.string().min(1, '예약 마감 일시를 입력해 주세요.'),
    event_start: z.string().min(1, '행사 시작 일시를 입력해 주세요.'),
    event_end: z.string().min(1, '행사 종료 일시를 입력해 주세요.'),
  })
  .superRefine((v, ctx) => {
    if (v.booking_start >= v.booking_end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['booking_end'],
        message: '예약 마감은 예약 시작 이후여야 합니다.',
      });
    }
    if (v.event_start >= v.event_end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['event_end'],
        message: '행사 종료는 행사 시작 이후여야 합니다.',
      });
    }
    // 예약 마감 ≤ 행사 시작 (db_schema chk_booking_limit)
    if (v.booking_end > v.event_start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['event_start'],
        message: '행사 시작은 예약 마감 이후여야 합니다.',
      });
    }
  });

export type EventFormValues = z.infer<typeof eventFormSchema>;

/** 행사 취소(상태 강제 변경) 사유 폼 — 최고 관리자 전용. */
export const cancelEventSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, '취소 사유를 입력해 주세요.')
    .max(500, '사유는 500자 이하여야 합니다.'),
});

export type CancelEventValues = z.infer<typeof cancelEventSchema>;
