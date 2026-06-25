import { parseCsv } from '@/lib/csv';
import { normalizePhone } from '@/schemas/authSchemas';
import type { ParticipantRole } from '@/types/user';

/**
 * CSV 일괄 업로드 매핑·검증 (page_admin_user_management.md §2.2).
 * 파싱(lib/csv)된 셀 배열을 users insert 페이로드로 매핑하고 라인별 오류를 리포트한다.
 * 오류가 하나라도 있으면 호출부는 DB 에 넣지 않고 오류 리스트만 표시한다(§2.2 오류 제어).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** users insert 페이로드(스칼라 컬럼). 빈 값은 null. */
export interface ParticipantInsert {
  role: ParticipantRole;
  name: string;
  email: string;
  phone_number: string | null;
  company_name: string | null;
  representative_name: string | null;
  contact_name: string | null;
  company_homepage: string | null;
  company_description: string | null;
  expert_organization: string | null;
  expert_position: string | null;
  expert_description: string | null;
}

export interface CsvRowError {
  /** 1-based 데이터 라인 번호(헤더 다음 행이 1번). */
  line: number;
  message: string;
}

export interface CsvParseSummary {
  rows: ParticipantInsert[];
  errors: CsvRowError[];
  /** 헤더를 제외한 데이터 행 수. */
  totalDataRows: number;
}

/** 표준 컬럼 키 → 허용 헤더 별칭(소문자·트림 기준). */
const HEADER_ALIASES: Record<keyof ParticipantInsert, string[]> = {
  role: ['role', '역할', '구분'],
  name: ['name', '이름', '성명'],
  email: ['email', '이메일', '메일'],
  phone_number: ['phone', 'phone_number', '연락처', '휴대전화', '전화번호', '전화'],
  company_name: ['company', 'company_name', '기업명', '회사명'],
  representative_name: ['representative', 'representative_name', '대표자명', '대표자', '대표명'],
  contact_name: ['contact', 'contact_name', '담당자명', '담당자'],
  company_homepage: ['homepage', 'company_homepage', '홈페이지', '웹사이트'],
  company_description: ['company_description', '기업소개', '회사소개', '소개'],
  expert_organization: ['organization', 'expert_organization', '소속', '기관'],
  expert_position: ['position', 'expert_position', '직책', '직위'],
  expert_description: ['expert_description', '전문가소개', '소개글'],
};

/** 다운로드용 CSV 템플릿(헤더 + 예시 2행). 표준 한국어 헤더를 사용한다. */
export const CSV_TEMPLATE_HEADERS = [
  '역할',
  '이름',
  '이메일',
  '연락처',
  '기업명',
  '대표자명',
  '담당자명',
  '소속',
  '직책',
];

export const CSV_TEMPLATE = [
  CSV_TEMPLATE_HEADERS.join(','),
  'STARTUP,김창업,founder@example.com,01012345678,예시스타트업,김창업,이담당,,',
  'EXPERT,박전문,expert@example.com,01087654321,,,,,예시기관,수석위원',
].join('\r\n');

function normalizeRole(raw: string): ParticipantRole | null {
  const v = raw.trim().toUpperCase();
  if (v === 'EXPERT' || raw.trim() === '전문가') return 'EXPERT';
  if (v === 'STARTUP' || raw.trim() === '스타트업') return 'STARTUP';
  return null;
}

/** 빈 문자열 → null. */
const orNull = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * CSV 텍스트를 검증해 삽입 가능한 행과 라인별 오류로 분리한다.
 * @param text 업로드된 CSV 원문
 * @param existingEmails 활성 사용자(소프트 삭제 제외)의 이메일 소문자 집합(중복 검사용)
 */
export function parseUserCsv(text: string, existingEmails: Set<string>): CsvParseSummary {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], errors: [{ line: 0, message: '내용이 없는 파일입니다.' }], totalDataRows: 0 };
  }

  // 헤더 → 컬럼 인덱스 매핑.
  const header = table[0].map((h) => h.trim().toLowerCase());
  const colIndex = {} as Record<keyof ParticipantInsert, number>;
  (Object.keys(HEADER_ALIASES) as (keyof ParticipantInsert)[]).forEach((key) => {
    colIndex[key] = header.findIndex((h) => HEADER_ALIASES[key].includes(h));
  });

  const missingRequired = (['role', 'name', 'email'] as const).filter((k) => colIndex[k] === -1);
  if (missingRequired.length > 0) {
    return {
      rows: [],
      errors: [{ line: 0, message: `필수 헤더가 없습니다: ${missingRequired.join(', ')} (템플릿을 내려받아 작성해 주세요).` }],
      totalDataRows: 0,
    };
  }

  const cell = (r: string[], key: keyof ParticipantInsert): string =>
    colIndex[key] === -1 ? '' : (r[colIndex[key]] ?? '');

  const rows: ParticipantInsert[] = [];
  const errors: CsvRowError[] = [];
  const seenInFile = new Set<string>();
  const dataRows = table.slice(1);

  dataRows.forEach((r, idx) => {
    const line = idx + 1;
    const name = cell(r, 'name').trim();
    const email = cell(r, 'email').trim();
    const roleRaw = cell(r, 'role').trim();
    const phoneRaw = cell(r, 'phone_number').trim();

    if (!name || !email || !roleRaw) {
      errors.push({ line, message: '이름·이메일·역할은 필수입니다.' });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ line, message: '이메일 형식이 올바르지 않습니다.' });
      return;
    }
    const role = normalizeRole(roleRaw);
    if (!role) {
      errors.push({ line, message: '역할은 EXPERT 또는 STARTUP 이어야 합니다.' });
      return;
    }
    if (phoneRaw && !/^0\d{9,10}$/.test(normalizePhone(phoneRaw))) {
      errors.push({ line, message: '휴대전화 번호 형식이 올바르지 않습니다.' });
      return;
    }

    const emailKey = email.toLowerCase();
    if (seenInFile.has(emailKey)) {
      errors.push({ line, message: '파일 내에서 이메일이 중복됩니다.' });
      return;
    }
    if (existingEmails.has(emailKey)) {
      errors.push({ line, message: '이미 등록된 이메일입니다.' });
      return;
    }
    seenInFile.add(emailKey);

    rows.push({
      role,
      name,
      email,
      phone_number: phoneRaw ? normalizePhone(phoneRaw) : null,
      company_name: orNull(cell(r, 'company_name')),
      representative_name: orNull(cell(r, 'representative_name')),
      contact_name: orNull(cell(r, 'contact_name')),
      company_homepage: orNull(cell(r, 'company_homepage')),
      company_description: orNull(cell(r, 'company_description')),
      expert_organization: orNull(cell(r, 'expert_organization')),
      expert_position: orNull(cell(r, 'expert_position')),
      expert_description: orNull(cell(r, 'expert_description')),
    });
  });

  return { rows, errors, totalDataRows: dataRows.length };
}
