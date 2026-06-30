import { useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { participantClient } from '@/lib/participantClient';
import { BUCKET_SPEC, createSignedUrlWithClient, validateParticipantFile } from '@/lib/storage';
import { formatDateTime } from '@/lib/datetime';
import { useMyProposal, useSetMyProposal } from '@/hooks/useStartupPortal';

interface ProposalUploadPanelProps {
  /** 스타트업 본인 user_id. */
  userId: string;
  /** 업로드 시각 표기에 쓰는 타임존(선택 행사 기준). */
  timezone: string;
}

const SPEC = BUCKET_SPEC.STARTUP;

/**
 * 스타트업 IR/소개서 자가 업로드 패널 (page 8-H).
 * 본인 소개서 현황·보기·업로드/교체·해제를 participantClient(커스텀 JWT)로 처리한다.
 * 미업로드 기업은 관리자가 대신 업로드할 수도 있으므로(병행), 갱신은 폴링 없이 수동 새로고침에 의존.
 */
export function ProposalUploadPanel({ userId, timezone }: ProposalUploadPanelProps) {
  const proposalQ = useMyProposal(userId);
  const setM = useSetMyProposal(userId);

  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  const current = proposalQ.data;
  const hasCurrent = Boolean(current?.filePath);

  const handleSelect = (selected: File | null) => {
    setLocalError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const msg = validateParticipantFile('STARTUP', selected);
    if (msg) {
      setLocalError(msg);
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const openCurrent = async () => {
    if (!current?.filePath) return;
    setLocalError(null);
    setViewing(true);
    try {
      const url = await createSignedUrlWithClient(participantClient, current.filePath, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setViewing(false);
    }
  };

  const upload = () => {
    if (!file) return;
    setM.mutate(
      { file },
      {
        onSuccess: () => setFile(null),
      },
    );
  };

  const clear = () => {
    setM.mutate({ clear: true, currentPath: current?.filePath ?? null });
  };

  const mutationError = setM.isError ? (setM.error as Error).message : null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-base">사업소개서(IR) 제출</h2>
        <span className="text-xs text-neutral-base/60">{SPEC.hint}</span>
      </div>
      <p className="text-sm text-neutral-base/70">
        상담 전 사업소개서를 직접 업로드해 주세요. 전문가가 매칭된 상담에서 열람할 수 있습니다.
      </p>

      {proposalQ.isError && (
        <Alert tone="error">소개서 상태를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {/* 현재 상태 */}
      {hasCurrent ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="font-medium text-neutral-base">제출됨</span>
          {current?.uploadedAt && (
            <span className="text-xs text-neutral-base/60">
              마지막 업로드 {formatDateTime(current.uploadedAt, timezone)}
            </span>
          )}
          <Button type="button" variant="outline" onClick={openCurrent} loading={viewing}>
            보기
          </Button>
          <button
            type="button"
            onClick={clear}
            disabled={setM.isPending}
            className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-brand hover:bg-danger-surface disabled:opacity-50"
          >
            제출 취소
          </button>
        </div>
      ) : (
        !proposalQ.isLoading && (
          <Alert tone="info">아직 제출된 사업소개서가 없습니다. 아래에서 PDF 파일을 업로드해 주세요.</Alert>
        )
      )}

      {/* 파일 선택 + 업로드 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold text-neutral-base">
          {hasCurrent ? '새 파일로 교체' : '파일 선택'}
        </label>
        <input
          type="file"
          accept={SPEC.acceptAttr}
          onChange={(e) => handleSelect(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-neutral-base file:mr-3 file:rounded-md file:border file:border-border file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-neutral-base hover:file:bg-surface"
        />
        {file && (
          <p className="text-xs text-neutral-base/70">
            선택됨: {file.name} ({Math.ceil(file.size / 1024)}KB)
          </p>
        )}
        <div>
          <Button type="button" onClick={upload} disabled={!file} loading={setM.isPending}>
            {hasCurrent ? '교체 업로드' : '업로드'}
          </Button>
        </div>
      </div>

      {localError && <p className="text-sm font-medium text-brand">{localError}</p>}
      {mutationError && <p className="text-sm font-medium text-brand">{mutationError}</p>}
    </Card>
  );
}
