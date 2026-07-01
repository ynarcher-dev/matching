import { useRef, useState } from 'react';
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
 * 스타트업 IR/소개서 자가 업로드 카드 (자료 첨부 §2 소개서/IR 제출).
 * 파일을 고르면 즉시 업로드하고(별도 저장 버튼 없음), 업로드된 파일명·시각을 보여준다.
 * 액션은 보기 / 빼기(제출 취소) / 바꾸기(새 파일 업로드)만 노출한다.
 */
export function ProposalUploadPanel({ userId, timezone }: ProposalUploadPanelProps) {
  const proposalQ = useMyProposal(userId);
  const setM = useSetMyProposal(userId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  const current = proposalQ.data;
  const hasCurrent = Boolean(current?.filePath);

  const openPicker = () => inputRef.current?.click();

  // 파일 선택 즉시 검증 후 업로드(교체/신규 공통).
  const handleSelect = (selected: File | null) => {
    setLocalError(null);
    if (!selected) return;
    const msg = validateParticipantFile('STARTUP', selected);
    if (msg) {
      setLocalError(msg);
      return;
    }
    setM.mutate({ file: selected });
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

  const remove = () => {
    setM.mutate({ clear: true, currentPath: current?.filePath ?? null });
  };

  const mutationError = setM.isError ? (setM.error as Error).message : null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-base">소개서/IR 제출</h2>
        <span className="text-xs text-neutral-base/60">{SPEC.hint}</span>
      </div>
      <p className="text-sm text-neutral-base/70">
        상담 전 사업소개서(PDF)를 업로드해 주세요. 전문가가 매칭된 상담에서 열람합니다.
      </p>

      {proposalQ.isError && (
        <Alert tone="error">
          소개서 상태를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.
        </Alert>
      )}

      {/* 공용 숨김 파일 입력(신규·교체 모두 여기로 트리거). */}
      <input
        ref={inputRef}
        type="file"
        accept={SPEC.acceptAttr}
        className="hidden"
        onChange={(e) => {
          handleSelect(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />

      {hasCurrent ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-medium text-neutral-base">
            📄 {current?.fileName ?? '제출된 파일'}
          </span>
          {current?.uploadedAt && (
            <span className="text-xs text-neutral-base/60">
              업로드 {formatDateTime(current.uploadedAt, timezone)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" onClick={openCurrent} loading={viewing}>
              보기
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={openPicker}
              loading={setM.isPending}
            >
              바꾸기
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={remove}
              disabled={setM.isPending}
              className="text-brand hover:bg-danger-surface"
            >
              빼기
            </Button>
          </div>
        </div>
      ) : (
        !proposalQ.isLoading && (
          <div className="flex flex-col items-start gap-3">
            <Alert tone="info">
              아직 제출된 소개서가 없습니다. PDF 파일을 업로드해 주세요.
            </Alert>
            <Button type="button" onClick={openPicker} loading={setM.isPending}>
              파일 업로드
            </Button>
          </div>
        )
      )}

      {localError && <p className="text-sm font-medium text-brand">{localError}</p>}
      {mutationError && <p className="text-sm font-medium text-brand">{mutationError}</p>}
    </Card>
  );
}
