/**
 * 내보내기(CSV/XLSX) 셀 값의 수식 인젝션(Formula Injection) 방어 유틸.
 * 근거: docs/security_remediation_plan.md A-1 (감사 F-1, P0).
 *
 * 스프레드시트(엑셀/구글시트/LibreOffice)는 셀 문자열이 `=`, `+`, `-`, `@`,
 * TAB(0x09), CR(0x0D)로 시작하면 수식/명령으로 해석한다. 사용자 입력이 그대로
 * 셀에 들어가면 `=HYPERLINK(...)`, `=cmd|...` 같은 페이로드가 실행될 수 있다.
 * 위험 접두 문자로 시작하는 문자열 앞에 작은따옴표(')를 붙여 강제로 텍스트화한다.
 */

/** 셀을 수식으로 오인시키는 위험 접두 문자(=, +, -, @, TAB, CR). */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * 문자열 셀이 수식 트리거 문자로 시작하면 `'` prefix 로 무력화한다.
 * 숫자·null 등 비문자열은 그대로 반환(엑셀 숫자 셀 보존).
 */
export function sanitizeCell<T>(value: T): T | string {
  if (typeof value === 'string' && FORMULA_TRIGGER.test(value)) {
    return `'${value}`;
  }
  return value;
}
