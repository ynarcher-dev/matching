import { useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import {
  useAddCompanyLink,
  useDeleteCompanyLink,
  useMyCompanyLinks,
  type CompanyLink,
} from '@/hooks/useStartupPortal';

interface ReferenceUrlPanelProps {
  /** 스타트업 본인 user_id. */
  userId: string;
}

/** http(s):// 스킴이 없으면 https 를 붙인다(외부 링크 안전 처리). */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/**
 * 참고 URL 공유 카드 (자료 첨부 §3 URL 공유).
 * 소개 홈페이지·노션·웹 IR 등 링크를 URL + 부연설명으로 여러 개 추가/삭제한다(0073 company_links).
 * 첫 링크는 대표 URL(company_homepage)로 자동 동기화되어 전문가 Split View·관리자 상세에 노출된다.
 */
export function ReferenceUrlPanel({ userId }: ReferenceUrlPanelProps) {
  const linksQ = useMyCompanyLinks(userId);
  const addM = useAddCompanyLink(userId);
  const deleteM = useDeleteCompanyLink(userId);

  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const links = linksQ.data ?? [];

  const add = () => {
    setLocalError(null);
    if (!url.trim()) {
      setLocalError('URL 을 입력해 주세요.');
      return;
    }
    addM.mutate(
      { url: url.trim(), label: label.trim() },
      {
        onSuccess: () => {
          setUrl('');
          setLabel('');
        },
      },
    );
  };

  const addError = addM.isError ? (addM.error as Error).message : null;
  const deleteError = deleteM.isError ? (deleteM.error as Error).message : null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-neutral-base">URL 공유</h2>
        <p className="text-sm text-neutral-base/70">
          소개 홈페이지·노션·웹 IR 등 참고 링크를 부연설명과 함께 등록해 주세요. 전문가가 상담 전
          확인합니다.
        </p>
      </div>

      {linksQ.isError && (
        <Alert tone="error">참고 URL 을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {/* 등록된 링크 목록 */}
      {links.length > 0 && (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              onDelete={() => deleteM.mutate(link.id)}
              deleting={deleteM.isPending}
            />
          ))}
        </ul>
      )}

      {/* 추가 폼: URL + 부연설명 */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <label className="text-sm font-semibold text-neutral-base">참고 URL 추가</label>
        <input
          type="url"
          inputMode="url"
          maxLength={500}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="부연설명 (예: 회사 소개 노션, 제품 데모 영상) — 선택"
            className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <Button type="button" className="shrink-0" onClick={add} loading={addM.isPending}>
            추가
          </Button>
        </div>
      </div>

      {localError && <p className="text-sm font-medium text-brand">{localError}</p>}
      {addError && <p className="text-sm font-medium text-brand">{addError}</p>}
      {deleteError && <p className="text-sm font-medium text-brand">{deleteError}</p>}
    </Card>
  );
}

/** 등록된 링크 1건: 설명·URL 표시 + 새 탭 열기 + 삭제. */
function LinkRow({
  link,
  onDelete,
  deleting,
}: {
  link: CompanyLink;
  onDelete: () => void;
  deleting: boolean;
}) {
  const href = normalizeUrl(link.url);
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        {link.label && (
          <span className="truncate text-sm font-semibold text-neutral-base">{link.label}</span>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-sm text-brand hover:underline"
          title={link.url}
        >
          🔗 {link.url}
        </a>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onDelete}
        disabled={deleting}
        className="shrink-0 text-brand hover:bg-danger-surface"
      >
        삭제
      </Button>
    </li>
  );
}
