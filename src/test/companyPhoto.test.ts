import { describe, it, expect } from 'vitest';
import {
  validatePhotoFile,
  buildCompanyStatuses,
  summarizePhotoStatus,
  filterCompanyStatuses,
  PHOTO_MAX_BYTES,
} from '@/lib/companyPhoto';
import type { PhotoCompany } from '@/types/companyPhoto';

/** File 더미 생성(타입/크기만 검증에 사용). */
function fakeFile(type: string, size: number): File {
  const f = new File(['x'], 'photo', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const companies: PhotoCompany[] = [
  { userId: 'b', companyName: '베타', contactName: '김대표' },
  { userId: 'a', companyName: '알파', contactName: '이대표' },
  { userId: 'c', companyName: '감마', contactName: '박매니저' },
];

describe('companyPhoto.validatePhotoFile', () => {
  it('이미지가 아니면 거부', () => {
    expect(validatePhotoFile(fakeFile('application/pdf', 1000))).toMatch(/이미지/);
  });
  it('용량 초과는 거부', () => {
    expect(validatePhotoFile(fakeFile('image/jpeg', PHOTO_MAX_BYTES + 1))).toMatch(/용량/);
  });
  it('정상 이미지는 통과(null)', () => {
    expect(validatePhotoFile(fakeFile('image/jpeg', 1024))).toBeNull();
  });
});

describe('companyPhoto.buildCompanyStatuses', () => {
  it('사진 0장 기업 포함 + 개수/마지막 업로드 집계 + 기업명 정렬', () => {
    const photos = [
      { company_user_id: 'a', created_at: '2026-06-26T01:00:00Z' },
      { company_user_id: 'a', created_at: '2026-06-26T03:00:00Z' },
      { company_user_id: 'b', created_at: '2026-06-26T02:00:00Z' },
    ];
    const statuses = buildCompanyStatuses(companies, photos);
    // ko 정렬: 감마, 베타, 알파
    expect(statuses.map((s) => s.companyName)).toEqual(['감마', '베타', '알파']);
    const a = statuses.find((s) => s.userId === 'a')!;
    expect(a.photoCount).toBe(2);
    expect(a.lastUploadedAt).toBe('2026-06-26T03:00:00Z'); // 최신값
    const c = statuses.find((s) => s.userId === 'c')!;
    expect(c.photoCount).toBe(0);
    expect(c.lastUploadedAt).toBeNull();
  });
});

describe('companyPhoto.summarizePhotoStatus', () => {
  it('전체/있음/없음/총 사진 요약', () => {
    const statuses = buildCompanyStatuses(companies, [
      { company_user_id: 'a', created_at: '2026-06-26T01:00:00Z' },
      { company_user_id: 'b', created_at: '2026-06-26T02:00:00Z' },
    ]);
    expect(summarizePhotoStatus(statuses)).toEqual({
      totalCompanies: 3,
      withPhotos: 2,
      withoutPhotos: 1,
      totalPhotos: 2,
    });
  });

  it('사진 없을 때 요약', () => {
    const statuses = buildCompanyStatuses(companies, []);
    expect(summarizePhotoStatus(statuses)).toEqual({
      totalCompanies: 3,
      withPhotos: 0,
      withoutPhotos: 3,
      totalPhotos: 0,
    });
  });
});

describe('companyPhoto.filterCompanyStatuses', () => {
  const statuses = buildCompanyStatuses(companies, []);
  it('빈 검색어는 전체', () => {
    expect(filterCompanyStatuses(statuses, '   ')).toHaveLength(3);
  });
  it('기업명 부분일치', () => {
    expect(filterCompanyStatuses(statuses, '알파').map((s) => s.userId)).toEqual(['a']);
  });
  it('담당자명 부분일치', () => {
    expect(filterCompanyStatuses(statuses, '매니저').map((s) => s.userId)).toEqual(['c']);
  });
});
