import { z } from 'zod';

/**
 * 행사 상세 대시보드 폼 검증 (page_admin_event_detail.md §2.1, §3.2).
 * 행사장 테이블 등록/편집과 강제 배정 사유를 검증한다.
 */

/** 행사장 테이블 등록/편집 (db_schema §2.7 — table_code 필수, event 내 UNIQUE). */
export const eventTableSchema = z.object({
  table_code: z
    .string()
    .trim()
    .min(1, '테이블 코드를 입력해 주세요.')
    .max(50, '테이블 코드는 50자 이하여야 합니다.'),
  description: z
    .string()
    .trim()
    .max(255, '설명은 255자 이하여야 합니다.')
    .optional()
    .or(z.literal('')),
  is_active: z.boolean(),
});

export type EventTableFormValues = z.infer<typeof eventTableSchema>;

/** 강제 배정/취소 사유 — 관리자 전용, 감사 로그 필수 입력. */
export const forceReasonSchema = z
  .string()
  .trim()
  .min(1, '사유를 입력해 주세요.')
  .max(500, '사유는 500자 이하여야 합니다.');

/**
 * 슬롯 자동 생성 폼 (generate_event_slots RPC, 0015 와 정합).
 * start_local 은 행사 timezone 기준 벽시계(datetime-local), 제출 시 UTC ISO 로 변환한다.
 * 숫자 상·하한은 RPC 의 RAISE EXCEPTION 범위와 동일하게 맞춘다.
 */
export const slotGenerationSchema = z.object({
  start_local: z.string().trim().min(1, '시작 시각을 입력해 주세요.'),
  session_minutes: z.coerce
    .number({ invalid_type_error: '세션 길이를 입력해 주세요.' })
    .int('정수로 입력해 주세요.')
    .min(1, '세션 길이는 1분 이상이어야 합니다.')
    .max(600, '세션 길이는 600분 이하여야 합니다.'),
  break_minutes: z.coerce
    .number({ invalid_type_error: '휴식 시간을 입력해 주세요.' })
    .int('정수로 입력해 주세요.')
    .min(0, '휴식 시간은 0분 이상이어야 합니다.')
    .max(600, '휴식 시간은 600분 이하여야 합니다.'),
  session_count: z.coerce
    .number({ invalid_type_error: '세션 횟수를 입력해 주세요.' })
    .int('정수로 입력해 주세요.')
    .min(1, '세션 횟수는 1회 이상이어야 합니다.')
    .max(50, '세션 횟수는 50회 이하여야 합니다.'),
  // 식사(점심) 시간대: 시작 시각과 같은 날의 벽시계(HH:mm). 최대 3개까지 추가(add) 가능.
  meals: z
    .array(
      z
        .object({
          start: z.string().trim().min(1, '시작 시각을 입력해 주세요.'),
          end: z.string().trim().min(1, '종료 시각을 입력해 주세요.'),
        })
        // HH:mm 은 문자열 비교로 시각 대소 판정 가능.
        .refine((m) => m.end > m.start, { message: '종료가 시작보다 늦어야 합니다.', path: ['end'] }),
    )
    .max(3, '식사 시간은 최대 3개까지 추가할 수 있습니다.')
    .optional(),
});

export type SlotGenerationValues = z.infer<typeof slotGenerationSchema>;
