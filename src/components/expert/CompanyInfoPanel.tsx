import { useEffect, useState } from 'react';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { Tabs } from '@/components/common/Tabs';
import { getProposalSignedUrl } from '@/hooks/useExpertPortal';
import type { SlotStartup } from '@/types/expert';

type InfoTab = 'file' | 'link' | 'request';

/**
 * Split View 좌측 기업 정보·자료 뷰어 (docs/expert_dashboard_split_view_ideation.md §3②).
 * 3가지 탭: [자료] 사업소개서 PDF 내장 뷰어 / [링크] 참고 URL / [요청] 상담 희망사항·기업 요약.
 * 전문가가 상담 대상 기업을 한 패널에서 다각도로 파악하도록 한다.
 */
export function CompanyInfoPanel({
  startup,
  counselingRequest,
  onRefresh,
}: {
  startup: SlotStartup | undefined;
  /** 스타트업이 입력한 상담 희망사항(matching_slots.counseling_request). */
  counselingRequest: string | null | undefined;
  /**
   * 스타트업 자료 원본을 서버에서 다시 가져온다([자료] 새로고침).
   * 소개서는 업로드마다 경로가 바뀌므로(관리자/스타트업 신규 업로드), 캐시된 경로만
   * 재서명해서는 새 파일이 반영되지 않는다. 원천 쿼리를 refetch 해 최신 경로를 받는다.
   */
  onRefresh?: () => Promise<unknown>;
}) {
  const [tab, setTab] = useState<InfoTab>('file');

  const tabOptions: ReadonlyArray<{ value: InfoTab; label: string }> = [
    { value: 'file', label: '자료' },
    { value: 'link', label: '링크' },
    { value: 'request', label: '요청' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-surface-raised">
      <div className="shrink-0 px-3 pt-2">
        <Tabs value={tab} options={tabOptions} onChange={(v) => setTab(v)} ariaLabel="기업 정보 탭" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'file' && <FileTab startup={startup} onRefresh={onRefresh} />}
        {tab === 'link' && <LinkTab homepage={startup?.homepage ?? null} />}
        {tab === 'request' && (
          <RequestTab
            request={counselingRequest ?? null}
            description={startup?.description ?? null}
          />
        )}
      </div>
    </div>
  );
}

/** [자료] 탭: 사업소개서 PDF 내장 뷰어 + 새 탭/다운로드 폴백(§5 모바일 호환). */
function FileTab({
  startup,
  onRefresh,
}: {
  startup: SlotStartup | undefined;
  onRefresh?: () => Promise<unknown>;
}) {
  const path = startup?.proposalFileUrl ?? null;
  const fileName = startup?.proposalFileName ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setUrl(await getProposalSignedUrl(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 새로고침: 원천 스타트업 자료를 먼저 다시 받아(신규 업로드로 바뀐 경로 반영) 재서명한다.
  // 경로가 바뀌면 아래 useEffect([path]) 가 새 경로를 자동 재서명하고, 경로가 같으면
  // (업로드 없음·서명 만료) 여기서 직접 재서명한다.
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      if (onRefresh) await onRefresh();
      if (path) setUrl(await getProposalSignedUrl(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (path) void load();
    // path 가 바뀌면(슬롯 전환·신규 업로드) 다시 발급. load 는 path 클로저로 재생성.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!path) {
    return <EmptyState>등록된 사업소개서(IR/PDF)가 없습니다.</EmptyState>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span
          className="truncate text-xs font-semibold text-neutral-base/70"
          title={fileName ?? '사업소개서'}
        >
          📄 {fileName ?? '사업소개서'}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={refresh} loading={loading}>
            새로고침
          </Button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface"
            >
              ↗ 새 탭/다운로드
            </a>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-surface">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : error ? (
          <div className="p-3">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : url ? (
          // 내장 PDF 뷰어 열기 파라미터: 상단 툴바(toolbar)·좌측 썸네일(navpanes) 숨김 + 가로 맞춤(FitH).
          <iframe
            src={`${url}#toolbar=0&navpanes=0&view=FitH`}
            title="사업소개서 미리보기"
            className="h-full w-full border-0"
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * [링크] 탭: 참고 URL(홈페이지·웹 IR).
 * 많은 사이트가 X-Frame-Options/CSP 로 iframe 임베드를 거부(ERR_BLOCKED_BY_RESPONSE)하므로,
 * 기본은 "새 탭으로 열기" 중심의 안내 카드로 두고, 미리보기는 사용자가 명시적으로 시도한다.
 */
function LinkTab({ homepage }: { homepage: string | null }) {
  const [preview, setPreview] = useState(false);

  if (!homepage) {
    return <EmptyState>등록된 참고 URL(홈페이지·웹 IR)이 없습니다.</EmptyState>;
  }
  const href = normalizeUrl(homepage);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-xs font-semibold text-neutral-base/70">🔗 {homepage}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {preview && (
            <Button variant="ghost" size="sm" onClick={() => setPreview(false)}>
              미리보기 닫기
            </Button>
          )}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface"
          >
            ↗ 새 탭으로 열기
          </a>
        </div>
      </div>

      {preview ? (
        <div className="min-h-0 flex-1 bg-surface">
          {/* 일부 사이트는 임베드를 차단할 수 있다(차단 시 새 탭으로 열기 안내). */}
          <iframe
            src={href}
            title="참고 URL 미리보기"
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-neutral-base">참고 URL</p>
            <p className="break-all text-sm text-neutral-base/70">{href}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              ↗ 새 탭으로 열기
            </a>
            <Button variant="outline" size="md" onClick={() => setPreview(true)}>
              여기에서 미리보기 시도
            </Button>
          </div>
          <p className="max-w-xs text-xs text-neutral-base/50">
            보안 설정상 홈페이지·은행·포털 등 상당수 사이트는 화면 내 미리보기를 차단합니다. 이 경우
            새 탭으로 열어 확인해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}

/** [요청] 탭: 상담 희망사항 + 기업 요약. */
function RequestTab({
  request,
  description,
}: {
  request: string | null;
  description: string | null;
}) {
  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-bold text-neutral-base">상담 희망사항</h4>
          {request ? (
            <p className="whitespace-pre-wrap rounded-lg border border-info-border bg-info-surface px-3 py-2.5 text-sm text-neutral-base">
              {request}
            </p>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-neutral-base/50">
              스타트업이 입력한 상담 희망사항이 없습니다.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-bold text-neutral-base">기업 요약</h4>
          {description ? (
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-neutral-base/90">
              {description}
            </p>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-neutral-base/50">
              등록된 기업 요약이 없습니다.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-base/50">
      {children}
    </div>
  );
}

/** http(s):// 스킴이 없으면 https 를 붙인다(외부 링크 안전 처리). */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
