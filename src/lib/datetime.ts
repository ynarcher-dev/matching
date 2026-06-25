import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

/**
 * 행사 timezone 변환 유틸 (dev_conventions.md 1장 — dayjs).
 * 관리자는 `datetime-local` 입력에 행사 현지 벽시계 시각을 입력하고,
 * DB 에는 timestamptz(UTC) 로 저장한다. 이 모듈이 두 표현 사이를 변환한다.
 */
dayjs.extend(utc);
dayjs.extend(timezone);

/** `datetime-local` 입력 포맷(벽시계, 타임존 없음). */
const LOCAL_INPUT_FORMAT = 'YYYY-MM-DDTHH:mm';

/**
 * `datetime-local` 벽시계 문자열을 해당 행사 timezone 으로 해석해 UTC ISO 로 변환.
 * 예: '2026-07-01T10:00' + 'Asia/Seoul' → '2026-07-01T01:00:00.000Z'
 */
export function localInputToIso(localValue: string, tz: string): string {
  return dayjs.tz(localValue, tz).toISOString();
}

/** UTC ISO 를 행사 timezone 벽시계 문자열(`datetime-local` value)로 변환. */
export function isoToLocalInput(iso: string, tz: string): string {
  return dayjs.utc(iso).tz(tz).format(LOCAL_INPUT_FORMAT);
}

/** 카드/상세에 노출할 한 시각 표기(예: 2026.07.01 10:00). */
export function formatDateTime(iso: string, tz: string): string {
  return dayjs.utc(iso).tz(tz).format('YYYY.MM.DD HH:mm');
}

/**
 * 기간 표기. 같은 날이면 종료는 시각만(예: 2026.07.01 10:00 ~ 18:00),
 * 다른 날이면 양쪽 모두 날짜 포함.
 */
export function formatRange(startIso: string, endIso: string, tz: string): string {
  const start = dayjs.utc(startIso).tz(tz);
  const end = dayjs.utc(endIso).tz(tz);
  const startText = start.format('YYYY.MM.DD HH:mm');
  const endText = start.isSame(end, 'day')
    ? end.format('HH:mm')
    : end.format('YYYY.MM.DD HH:mm');
  return `${startText} ~ ${endText}`;
}

/** 타임존 셀렉트 박스 선택지(자주 쓰는 권역). */
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Asia/Seoul', label: '서울 (Asia/Seoul, UTC+9)' },
  { value: 'Asia/Tokyo', label: '도쿄 (Asia/Tokyo, UTC+9)' },
  { value: 'Asia/Singapore', label: '싱가포르 (Asia/Singapore, UTC+8)' },
  { value: 'America/New_York', label: '뉴욕 (America/New_York)' },
  { value: 'America/Los_Angeles', label: '로스앤젤레스 (America/Los_Angeles)' },
  { value: 'Europe/London', label: '런던 (Europe/London)' },
  { value: 'UTC', label: '협정 세계시 (UTC)' },
];
