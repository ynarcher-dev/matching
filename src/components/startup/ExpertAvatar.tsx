/**
 * 전문가 프로필 사진(전문가별 보기 카드용).
 * Signed URL 이 있으면 이미지를, 없으면 이름 첫 글자 이니셜 플레이스홀더를 렌더한다.
 */
export function ExpertAvatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt={`${name} 프로필 사진`}
        className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
      />
    );
  }
  const initial = name.trim().slice(0, 1) || '?';
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-lg font-bold text-neutral-base/50">
      {initial}
    </div>
  );
}
