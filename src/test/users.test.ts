import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv';
import { parseUserCsv } from '@/lib/userCsv';
import { participantFormSchema, reasonSchema } from '@/schemas/userSchemas';
import { validateParticipantFile } from '@/lib/storage';

const UUID = '11111111-1111-1111-1111-111111111111';
const UUID2 = '22222222-2222-2222-2222-222222222222';
const UUID3 = '33333333-3333-3333-3333-333333333333';
const UUID4 = '44444444-4444-4444-4444-444444444444';

function fakeFile(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const HEADER = '역할,이름,이메일,연락처,기업명,대표자명';

describe('parseCsv', () => {
  it('기본 행/열을 분리한다', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('따옴표로 감싼 필드의 쉼표·줄바꿈·이스케이프 따옴표를 처리한다', () => {
    const text = 'name,memo\n"홍, 길동","줄1\n줄2""인용"""';
    expect(parseCsv(text)).toEqual([
      ['name', 'memo'],
      ['홍, 길동', '줄1\n줄2"인용"'],
    ]);
  });

  it('CRLF 줄바꿈과 완전히 빈 행을 처리한다', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseUserCsv', () => {
  const empty = new Set<string>();

  it('정상 행을 삽입 페이로드로 매핑한다', () => {
    const text = `${HEADER}\nSTARTUP,김창업,founder@example.com,01012345678,예시스타트업,김창업`;
    const r = parseUserCsv(text, empty);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      role: 'STARTUP',
      name: '김창업',
      email: 'founder@example.com',
      phone_number: '01012345678',
      company_name: '예시스타트업',
    });
  });

  it('필수 헤더가 없으면 거부한다', () => {
    const r = parseUserCsv('이름,이메일\n홍길동,a@b.com', empty);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain('필수 헤더');
  });

  it('필수값 누락·이메일 형식·역할 오류를 라인별로 리포트한다', () => {
    const text = [
      HEADER,
      'STARTUP,,no-name@example.com,,,', // 이름 누락
      'STARTUP,형식오류,not-an-email,,,', // 이메일 형식
      'INVALID,역할오류,role@example.com,,,', // 역할 오류
    ].join('\n');
    const r = parseUserCsv(text, empty);
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toEqual({ line: 1, message: '이름·이메일·역할은 필수입니다.' });
    expect(r.errors[1].line).toBe(2);
    expect(r.errors[2].message).toContain('EXPERT 또는 STARTUP');
  });

  it('파일 내 중복과 기존 활성 이메일 중복을 구분해 거부한다', () => {
    const text = [
      HEADER,
      'EXPERT,중복1,dup@example.com,,,',
      'EXPERT,중복2,dup@example.com,,,', // 파일 내 중복
      'EXPERT,기존중복,exists@example.com,,,', // 기존 중복
    ].join('\n');
    const r = parseUserCsv(text, new Set(['exists@example.com']));
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].message).toContain('파일 내');
    expect(r.errors[1].message).toContain('이미 등록');
  });

  it('휴대전화 형식 오류를 거부한다', () => {
    const text = `${HEADER}\nEXPERT,박전문,expert@example.com,123,,`;
    const r = parseUserCsv(text, empty);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain('휴대전화');
  });
});

describe('participantFormSchema', () => {
  const valid = {
    role: 'STARTUP' as const,
    name: '김창업',
    email: 'founder@example.com',
    phone_number: '010-1234-5678',
    company_name: '예시스타트업',
    representative_name: '',
    contact_name: '',
    company_homepage: '',
    company_description: '',
    expert_organization: '',
    expert_position: '',
    expert_description: '',
  };

  it('정상 입력을 통과시킨다(하이픈 포함 휴대전화 허용)', () => {
    expect(participantFormSchema.safeParse(valid).success).toBe(true);
  });

  it('이름·이메일 누락과 잘못된 이메일을 거부한다', () => {
    expect(participantFormSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false);
    expect(participantFormSchema.safeParse({ ...valid, email: 'bad' }).success).toBe(false);
  });

  it('연락처는 선택이지만 형식이 틀리면 거부한다', () => {
    expect(participantFormSchema.safeParse({ ...valid, phone_number: '' }).success).toBe(true);
    expect(participantFormSchema.safeParse({ ...valid, phone_number: '12345' }).success).toBe(false);
  });

  it('field_ids 는 생략 시 빈 배열로 기본값 처리된다', () => {
    const r = participantFormSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.field_ids).toEqual([]);
  });

  it('분야는 최대 3개까지만 허용한다', () => {
    expect(
      participantFormSchema.safeParse({ ...valid, field_ids: [UUID, UUID2, UUID3] }).success,
    ).toBe(true);
    expect(
      participantFormSchema.safeParse({ ...valid, field_ids: [UUID, UUID2, UUID3, UUID4] }).success,
    ).toBe(false);
  });
});

describe('validateParticipantFile', () => {
  it('스타트업은 10MB 이하 PDF 만 허용한다', () => {
    expect(validateParticipantFile('STARTUP', fakeFile('a.pdf', 'application/pdf', 1024))).toBeNull();
    expect(
      validateParticipantFile('STARTUP', fakeFile('a.png', 'image/png', 1024)),
    ).toContain('형식');
    expect(
      validateParticipantFile('STARTUP', fakeFile('a.pdf', 'application/pdf', 11 * 1024 * 1024)),
    ).toContain('용량');
  });

  it('전문가는 5MB 이하 이미지(jpg/png/webp)만 허용한다', () => {
    expect(validateParticipantFile('EXPERT', fakeFile('a.png', 'image/png', 1024))).toBeNull();
    expect(validateParticipantFile('EXPERT', fakeFile('a.webp', 'image/webp', 1024))).toBeNull();
    expect(
      validateParticipantFile('EXPERT', fakeFile('a.pdf', 'application/pdf', 1024)),
    ).toContain('형식');
    expect(
      validateParticipantFile('EXPERT', fakeFile('a.png', 'image/png', 6 * 1024 * 1024)),
    ).toContain('용량');
  });
});

describe('reasonSchema', () => {
  it('사유가 있으면 통과, 비면 거부', () => {
    expect(reasonSchema.safeParse({ reason: '분실 신고' }).success).toBe(true);
    expect(reasonSchema.safeParse({ reason: '   ' }).success).toBe(false);
  });
});
