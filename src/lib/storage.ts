import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { ParticipantRole } from '@/types/user';

/**
 * 참가자 첨부 파일 Storage 헬퍼 (page_admin_user_management.md §2.4, 0007_storage.sql).
 * 비공개 버킷 + 권한이 적용된 Signed URL 로만 제공한다(공개 URL 금지).
 * 객체 경로 규칙은 RLS(_storage_owner_id)와 정합: `{bucket}/{owner_user_id}/{filename}`.
 *   - STARTUP → proposals 버킷, 사업소개서 PDF
 *   - EXPERT  → avatars   버킷, 프로필 이미지
 */

export type FileBucket = 'proposals' | 'avatars';

interface BucketSpec {
  bucket: FileBucket;
  /** 허용 MIME 타입. */
  accept: string[];
  /** accept 속성용 확장자/타입 문자열. */
  acceptAttr: string;
  /** 최대 바이트. */
  maxBytes: number;
  /** 사람이 읽는 제한 안내. */
  hint: string;
}

const PROPOSAL_MAX = 10 * 1024 * 1024; // 10MB
// 전문가 프로필 사진은 리사이즈/압축 없이 원본 고화질 그대로 저장한다.
// 고해상도 원본(DSLR·휴대폰)이 막히지 않도록 여유 있게(Supabase 전역 기본 50MB 한도 내).
const AVATAR_MAX = 50 * 1024 * 1024; // 50MB

export const BUCKET_SPEC: Record<ParticipantRole, BucketSpec> = {
  STARTUP: {
    bucket: 'proposals',
    accept: ['application/pdf'],
    acceptAttr: 'application/pdf,.pdf',
    maxBytes: PROPOSAL_MAX,
    hint: 'PDF · 최대 10MB',
  },
  EXPERT: {
    bucket: 'avatars',
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    acceptAttr: 'image/jpeg,image/png,image/webp',
    maxBytes: AVATAR_MAX,
    hint: 'JPG·PNG·WEBP · 원본 고화질 · 최대 50MB',
  },
};

/** 역할별 파일 URL 이 저장되는 users 컬럼. */
export const FILE_COLUMN: Record<ParticipantRole, 'proposal_file_url' | 'profile_image_url'> = {
  STARTUP: 'proposal_file_url',
  EXPERT: 'profile_image_url',
};

/** 역할별 파일 표시 라벨. */
export const FILE_LABEL: Record<ParticipantRole, string> = {
  STARTUP: '사업소개서',
  EXPERT: '프로필 사진',
};

const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 업로드 전 클라이언트 검증. 통과하면 null, 실패하면 사용자 메시지. */
export function validateParticipantFile(role: ParticipantRole, file: File): string | null {
  const spec = BUCKET_SPEC[role];
  if (!spec.accept.includes(file.type)) {
    return `허용되지 않는 형식입니다 (${spec.hint}).`;
  }
  if (file.size > spec.maxBytes) {
    return `파일 용량이 너무 큽니다 (${spec.hint}).`;
  }
  return null;
}

/**
 * 객체 경로를 만든다. 소유자 폴더(`{bucket}/{userId}/`) 규칙은 RLS(_storage_owner_id)와 정합.
 *   - STARTUP(소개서): 업로드마다 고유 경로(`proposals/{userId}/{uuid}.pdf`)로 과거본을 보존한다
 *     (교체 이력 타임라인 — 0052). 이전 객체는 삭제하지 않는다.
 *   - EXPERT(프로필): 사용자당 1개 고정 경로(`avatars/{userId}/avatar.{ext}`, 교체 시 덮어쓰기).
 */
function buildObjectPath(role: ParticipantRole, userId: string, file: File): string {
  const spec = BUCKET_SPEC[role];
  const ext = EXT_BY_TYPE[file.type] ?? 'bin';
  if (role === 'STARTUP') {
    return `${spec.bucket}/${userId}/${crypto.randomUUID()}.${ext}`;
  }
  return `${spec.bucket}/${userId}/avatar.${ext}`;
}

/**
 * 주어진 클라이언트로 파일을 업로드하고 저장할 객체 경로를 반환한다(컬럼에는 이 경로를 저장).
 * 운영진은 `supabase`, 참가자(스타트업 자가 업로드)는 `participantClient` 를 넘겨 RLS 를 적용한다.
 * 같은 경로면 upsert 로 덮어쓰고, 확장자가 달라 경로가 바뀌면 호출부가 이전 경로를 정리한다.
 */
export async function uploadParticipantFileWithClient(
  client: SupabaseClient,
  role: ParticipantRole,
  userId: string,
  file: File,
): Promise<string> {
  const spec = BUCKET_SPEC[role];
  const path = buildObjectPath(role, userId, file);
  const objectKey = path.slice(spec.bucket.length + 1); // 버킷명 접두 제거(from(bucket) 기준 키)
  const { error } = await client.storage.from(spec.bucket).upload(objectKey, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw new Error(`파일 업로드에 실패했습니다: ${error.message}`);
  return path;
}

/** 운영진 클라이언트로 파일을 업로드한다(관리자 대행 등록). */
export async function uploadParticipantFile(
  role: ParticipantRole,
  userId: string,
  file: File,
): Promise<string> {
  return uploadParticipantFileWithClient(supabase, role, userId, file);
}

/** 주어진 클라이언트로 저장된 객체 경로(`{bucket}/...`)의 파일을 삭제한다. */
export async function removeParticipantFileWithClient(
  client: SupabaseClient,
  path: string,
): Promise<void> {
  const bucket = path.split('/')[0] as FileBucket;
  const objectKey = path.slice(bucket.length + 1);
  if (!objectKey) return;
  await client.storage.from(bucket).remove([objectKey]);
}

/** 저장된 객체 경로(`{bucket}/...`)의 파일을 삭제한다(운영진 클라이언트). */
export async function removeParticipantFile(path: string): Promise<void> {
  return removeParticipantFileWithClient(supabase, path);
}

/**
 * 주어진 Supabase 클라이언트로 객체 경로(`{bucket}/...`)의 단기 Signed URL 을 만든다.
 * 운영진은 `supabase`, 참가자(전문가/스타트업)는 `participantClient` 를 넘겨 RLS 를 적용한다.
 */
export async function createSignedUrlWithClient(
  client: SupabaseClient,
  path: string,
  expiresInSec = 60,
): Promise<string> {
  const bucket = path.split('/')[0] as FileBucket;
  const objectKey = path.slice(bucket.length + 1);
  const { data, error } = await client.storage.from(bucket).createSignedUrl(objectKey, expiresInSec);
  if (error || !data) throw new Error(`파일 링크 생성에 실패했습니다: ${error?.message ?? ''}`);
  return data.signedUrl;
}

/**
 * 여러 객체 경로(`{bucket}/...`, 동일 버킷 가정)의 단기 Signed URL 을 한 번에 만든다.
 * 반환은 경로→URL 맵(생성 실패한 항목은 누락). 전문가 프로필 사진 일괄 표시 등에 쓴다.
 */
export async function createSignedUrlsWithClient(
  client: SupabaseClient,
  paths: string[],
  expiresInSec = 300,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;
  const bucket = paths[0].split('/')[0] as FileBucket;
  const keyToPath = new Map<string, string>();
  const objectKeys = paths.map((p) => {
    const key = p.slice(bucket.length + 1);
    keyToPath.set(key, p);
    return key;
  });
  const { data, error } = await client.storage.from(bucket).createSignedUrls(objectKeys, expiresInSec);
  if (error) throw new Error(`파일 링크 생성에 실패했습니다: ${error.message}`);
  for (const item of data ?? []) {
    if (item.error || !item.signedUrl || !item.path) continue;
    const full = keyToPath.get(item.path);
    if (full) result.set(full, item.signedUrl);
  }
  return result;
}

/** 저장된 객체 경로로 단기 Signed URL 을 생성한다(운영진 클라이언트, 기본 60초). */
export async function createParticipantSignedUrl(
  path: string,
  expiresInSec = 60,
): Promise<string> {
  return createSignedUrlWithClient(supabase, path, expiresInSec);
}
