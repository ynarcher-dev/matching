import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import type { OperatorSecretResult } from '@/types/operator';

interface OperatorSecretModalProps {
  open: boolean;
  onClose: () => void;
  /** 생성/재설정 결과(임시 비밀번호 또는 초대 링크). */
  result: OperatorSecretResult | null;
  /** 대상 운영자 이메일(전달 안내용). */
  email?: string;
}

/**
 * 운영자 임시 비밀번호 / 초대 링크 1회 노출 모달.
 * 이 화면을 닫으면 다시 볼 수 없으므로 즉시 전달하도록 안내한다(EmergencyLinkModal 과 동일 위계).
 */
export function OperatorSecretModal({ open, onClose, result, email }: OperatorSecretModalProps) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;

  const secret = result.invite_link ?? result.temp_password ?? '';
  const isLink = Boolean(result.invite_link);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isLink ? '비밀번호 설정 링크' : '임시 비밀번호'}
      size="md"
      footer={<Button onClick={onClose}>완료</Button>}
    >
      <div className="flex flex-col gap-3">
        <Alert tone="success">
          {isLink
            ? '비밀번호 설정용 링크가 발급되었습니다.'
            : '임시 비밀번호가 발급되었습니다.'}{' '}
          이 화면을 닫으면 다시 볼 수 없으니 지금 전달하세요.
        </Alert>
        {email && (
          <p className="text-sm text-neutral-base">
            대상: <span className="font-semibold">{email}</span>
          </p>
        )}
        <textarea
          readOnly
          value={secret}
          rows={isLink ? 3 : 1}
          className="w-full break-all rounded-lg border border-border bg-surface px-3 py-2 text-sm text-neutral-base outline-none"
        />
        <Button variant="outline" onClick={onCopy}>
          {copied ? '복사됨' : isLink ? '링크 복사' : '비밀번호 복사'}
        </Button>
      </div>
    </Modal>
  );
}
