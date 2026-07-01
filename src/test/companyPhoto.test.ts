import { describe, it, expect } from 'vitest';
import {
  validatePhotoFile,
  buildCompanyStatuses,
  summarizePhotoStatus,
  filterCompanyStatuses,
  stripJpegMetadata,
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

describe('companyPhoto.stripJpegMetadata (EXIF strip — A-8)', () => {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  /** 마커 세그먼트(길이 필드 = payload + 2). */
  const seg = (marker: number, payload: number[]) => {
    const len = payload.length + 2;
    return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
  };

  // SOI + APP1(Exif/GPS) + APP0(JFIF) + DQT + COM(주석) + SOS + 엔트로피 + EOI
  const app1Exif = seg(0xe1, ascii('Exif\0\0GPS-secret-location'));
  const app0Jfif = seg(0xe0, ascii('JFIF\0'));
  const dqt = seg(0xdb, [0x00, 0x01, 0x02, 0x03]);
  const com = seg(0xfe, ascii('device serial 12345'));
  const sos = seg(0xda, [0x00, 0x0c]);
  const jpeg = Uint8Array.from([
    0xff, 0xd8, ...app1Exif, ...app0Jfif, ...dqt, ...com, ...sos, 0x11, 0x22, 0x33, 0xff, 0xd9,
  ]);

  it('APP1(Exif/GPS)·COM(주석) 세그먼트를 제거한다', () => {
    const out = stripJpegMetadata(jpeg)!;
    expect(out).not.toBeNull();
    // 제거 대상 시그니처가 결과에서 사라짐
    const hasSeq = (hay: Uint8Array, needle: number[]) => {
      for (let i = 0; i + needle.length <= hay.length; i++) {
        if (needle.every((b, j) => hay[i + j] === b)) return true;
      }
      return false;
    };
    expect(hasSeq(out, ascii('Exif'))).toBe(false);
    expect(hasSeq(out, ascii('GPS-secret-location'))).toBe(false);
    expect(hasSeq(out, ascii('device serial 12345'))).toBe(false);
  });

  it('JFIF(APP0)·양자화표(DQT)·엔트로피 데이터는 보존한다', () => {
    const out = stripJpegMetadata(jpeg)!;
    const hasSeq = (hay: Uint8Array, needle: number[]) => {
      for (let i = 0; i + needle.length <= hay.length; i++) {
        if (needle.every((b, j) => hay[i + j] === b)) return true;
      }
      return false;
    };
    expect(hasSeq(out, ascii('JFIF'))).toBe(true); // APP0 보존
    expect(hasSeq(out, [0xff, 0xdb])).toBe(true); // DQT 마커 보존
    expect(hasSeq(out, [0xff, 0xda, 0x00, 0x04, 0x00, 0x0c])).toBe(true); // SOS+페이로드
    expect(hasSeq(out, [0x11, 0x22, 0x33])).toBe(true); // 엔트로피 데이터
    expect(out[out.length - 2]).toBe(0xff); // EOI
    expect(out[out.length - 1]).toBe(0xd9);
    // SOI 유지
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
  });

  it('JPEG(SOI) 이 아니면 null 반환 → 호출부가 원본 유지', () => {
    expect(stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    expect(stripJpegMetadata(Uint8Array.from([0xff]))).toBeNull(); // 너무 짧음
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
