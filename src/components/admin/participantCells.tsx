import { useRef, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { TableActionButton } from '@/components/common/ActionButton';
import { formatDateTime } from '@/lib/datetime';
import { BUCKET_SPEC, createParticipantSignedUrl, validateParticipantFile } from '@/lib/storage';
import { useSetParticipantFile } from '@/hooks/useUserMutations';
import type { ParticipantWithAuth } from '@/types/user';

type ProposalFileUser = { id: string; proposal_file_url: string | null };

const DISPLAY_TZ = 'Asia/Seoul';

export function LastLoginCell({ user }: { user: Pick<ParticipantWithAuth, 'last_login_at'> }) {
  return user.last_login_at ? (
    <span className="whitespace-nowrap text-neutral-base/80">
      {formatDateTime(user.last_login_at, DISPLAY_TZ)}
    </span>
  ) : (
    <span className="text-neutral-base/50">미로그인</span>
  );
}

export function ProposalStatusCell({ user }: { user: ProposalFileUser }) {
  if (!user.proposal_file_url) {
    return <ProposalInlineUpload user={user} />;
  }
  return <FileCell path={user.proposal_file_url} label="업로드됨" active />;
}

function ProposalInlineUpload({ user }: { user: ProposalFileUser }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const setFile = useSetParticipantFile();

  const onPick = (file: File | null) => {
    setError(null);
    if (!file) return;
    const msg = validateParticipantFile('STARTUP', file);
    if (msg) {
      setError(msg);
      return;
    }
    setFile.mutate(
      { userId: user.id, role: 'STARTUP', file, currentFilePath: user.proposal_file_url },
      { onError: (e) => setError((e as Error).message) },
    );
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={BUCKET_SPEC.STARTUP.acceptAttr}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <TableActionButton
        type="button"
        tone="danger"
        onClick={() => inputRef.current?.click()}
        disabled={setFile.isPending}
        title={`미업로드 상태입니다. ${BUCKET_SPEC.STARTUP.hint} 소개서를 올립니다.`}
        className="min-w-[4.5rem] whitespace-nowrap"
      >
        {setFile.isPending ? '업로드 중' : '미업로드'}
      </TableActionButton>
      {error && <span className="whitespace-normal text-xs font-medium text-brand">{error}</span>}
    </div>
  );
}

/** 분야 컬럼은 가장 좁게 유지 — 나머지 핵심 정보가 한 줄에 보이도록 1개만 노출하고 나머지는 +N 으로 접는다. */
const FIELDS_MAX_VISIBLE = 1;

export function FieldsCell({ ids, nameById }: { ids: string[]; nameById: Map<string, string> }) {
  if (ids.length === 0) return <span className="text-neutral-base/50">-</span>;
  const names = ids.map((id) => nameById.get(id) ?? '알 수 없음');
  const visible = names.slice(0, FIELDS_MAX_VISIBLE);
  const hiddenCount = names.length - visible.length;
  return (
    <div className="flex flex-nowrap items-center gap-1" title={names.join(', ')}>
      {visible.map((name, i) => (
        <Badge
          key={ids[i]}
          tone="muted"
          className="whitespace-nowrap font-medium text-neutral-base"
        >
          {name}
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <Badge tone="muted" className="whitespace-nowrap font-medium text-neutral-base/70">
          +{hiddenCount}
        </Badge>
      )}
    </div>
  );
}

export function FileCell({
  path,
  label = '보기',
  active = false,
}: {
  path: string | null;
  label?: string;
  active?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  if (!path) return <span className="text-neutral-base/50">-</span>;

  const open = async () => {
    setError(false);
    setLoading(true);
    try {
      const url = await createParticipantSignedUrl(path, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TableActionButton
      type="button"
      tone={active && !error ? 'primary' : error ? 'danger' : 'outline'}
      onClick={open}
      disabled={loading}
      className="min-w-[4.5rem] whitespace-nowrap"
    >
      {loading ? '여는 중' : error ? '오류 · 재시도' : label}
    </TableActionButton>
  );
}

export function RowAction({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <TableActionButton
      type="button"
      tone={danger ? 'danger' : 'outline'}
      onClick={onClick}
      className="whitespace-nowrap"
    >
      {children}
    </TableActionButton>
  );
}
