import { useMemo, useState, type ReactNode } from 'react';
import { Modal } from '@/components/common/Modal';
import { Badge } from '@/components/common/Badge';
import { formatDateTime } from '@/lib/datetime';
import { createParticipantSignedUrl } from '@/lib/storage';
import { companyName, BOOKING_TYPE_LABELS } from '@/lib/labels';
import { useFields } from '@/hooks/useFields';
import type { Tone } from '@/lib/tone';
import type { AssignableUser, BookingType, MatchingSlotRow } from '@/types/eventDetail';

interface SlotDetailModalProps {
  /** 열림 대상 슬롯(null 이면 닫힘). */
  slot: MatchingSlotRow | null;
  /** 슬롯의 스타트업 사용자(userById 로 해석해 전달). */
  startup: AssignableUser | undefined;
  /** 담당 전문가(userById 로 해석해 전달). */
  expert: AssignableUser | undefined;
  timezone: string;
  onClose: () => void;
}

/** 예약 경로별 배지 tone — 표(BookingScheduleTable)와 동일 기준(수동=success·AI=ai·강제=warning). */
const TYPE_TONE: Record<BookingType, Tone> = {
  NONE: 'muted',
  MANUAL: 'success',
  AUTO_AI: 'ai',
  ADMIN_FORCE: 'warning',
};

/** http(s):// 스킴이 없으면 https 를 붙인다(외부 링크 안전 처리). */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * 예약/진행 그리드 셀 클릭 시 열리는 슬롯 상세 모달.
 * 스타트업·전문가 정보와 상담 희망사항(전문가에게 궁금한 점)·첨부 파일·참고 링크를 한곳에서 보여준다.
 * 데이터 원천은 BookingScheduleTable / TimeGridSheet 와 동일(MatchingSlotRow + AssignableUser).
 */
export function SlotDetailModal({ slot, startup, expert, timezone, onClose }: SlotDetailModalProps) {
  const open = slot !== null;

  // 분야 id → 이름 매핑(캐시). 스타트업/전문가 분야 배지 표시용.
  const fieldsQ = useFields();
  const fieldNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fieldsQ.data ?? []) m.set(f.id, f.name);
    return m;
  }, [fieldsQ.data]);

  return (
    <Modal open={open} onClose={onClose} title="상담 신청 상세" size="lg">
      {slot && (
        <div className="flex flex-col gap-6">
          {/* 상단: 예약 경로 배지 + 시간대(어떤 슬롯인지) */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={TYPE_TONE[slot.booking_type]} size="11">
              {BOOKING_TYPE_LABELS[slot.booking_type]}
            </Badge>
            <span className="font-semibold text-neutral-base">
              {formatDateTime(slot.start_time, timezone)} ~{' '}
              {formatDateTime(slot.end_time, timezone).slice(-5)}
            </span>
          </div>

          {/* 스타트업 · 전문가 정보 — 카드 두 장을 나란히 */}
          <div className="-mt-3 grid gap-3 sm:grid-cols-2">
            <Section title="스타트업 정보">
              <Row label="기업명">{startup ? companyName(startup) : '(알 수 없음)'}</Row>
              <Row label="대표명">{startup?.representative_name || '-'}</Row>
              <Row label="연락처">{startup?.phone_number || '-'}</Row>
              <Row label="분야">
                <FieldTags ids={startup?.field_ids ?? []} nameById={fieldNameById} />
              </Row>
            </Section>

            <Section title="전문가 정보">
              <Row label="소속">{expert?.expert_organization || '-'}</Row>
              <Row label="직책">{expert?.expert_position || '-'}</Row>
              <Row label="연락처">{expert?.phone_number || '-'}</Row>
              <Row label="분야">
                <FieldTags ids={expert?.field_ids ?? []} nameById={fieldNameById} />
              </Row>
            </Section>
          </div>

          {/* 기업 소개 */}
          <section className="flex flex-col gap-1.5">
            <h4 className="text-sm font-bold text-neutral-base">기업 소개</h4>
            {startup?.company_description ? (
              <p className="whitespace-pre-wrap rounded-lg border border-border px-3 py-2.5 text-sm text-neutral-base/90">
                {startup.company_description}
              </p>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-neutral-base/50">
                등록된 기업 소개가 없습니다.
              </p>
            )}
          </section>

          {/* 상담 희망사항: 전문가에게 궁금한 점 */}
          <section className="flex flex-col gap-1.5">
            <h4 className="text-sm font-bold text-neutral-base">
              희망사항 (전문가에게 궁금한 점)
            </h4>
            {slot.counseling_request ? (
              <p className="whitespace-pre-wrap rounded-lg border border-info-border bg-info-surface px-3 py-2.5 text-sm text-neutral-base">
                {slot.counseling_request}
              </p>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-neutral-base/50">
                스타트업이 입력한 상담 희망사항이 없습니다.
              </p>
            )}
          </section>

          {/* 첨부파일 */}
          <section className="flex flex-col gap-1.5">
            <h4 className="text-sm font-bold text-neutral-base">첨부파일</h4>
            <div>
              <ProposalLink path={startup?.proposal_file_url ?? null} />
            </div>
          </section>

          {/* 첨부링크 */}
          <section className="flex flex-col gap-1.5">
            <h4 className="text-sm font-bold text-neutral-base">첨부링크</h4>
            <div>
              <HomepageLink homepage={startup?.company_homepage ?? null} />
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

/** 정보 카드: 제목 + 라벨/값 정의 리스트(회색 배경 없이 경계선 카드). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex h-full flex-col gap-2 rounded-lg border border-border p-4">
      <h4 className="text-sm font-bold text-neutral-base">{title}</h4>
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

/** 정의 리스트 한 행(라벨 + 값). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-neutral-base/55">{label}</dt>
      <dd className="text-neutral-base">{children}</dd>
    </>
  );
}

/** 분야 배지 목록(없으면 '-'). */
function FieldTags({ ids, nameById }: { ids: string[]; nameById: Map<string, string> }) {
  if (ids.length === 0) return <span className="text-neutral-base/50">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} tone="muted" size="11" className="font-medium text-neutral-base">
          {nameById.get(id) ?? '알 수 없음'}
        </Badge>
      ))}
    </div>
  );
}

/** 사업소개서(PDF) — 단기 Signed URL 로 새 탭에서 연다(비공개 버킷). */
function ProposalLink({ path }: { path: string | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  if (!path) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-neutral-base/45">
        📄 사업소개서 미첨부
      </span>
    );
  }

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
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        error
          ? 'border-danger-border bg-danger-surface text-danger'
          : 'border-border text-neutral-base hover:border-brand hover:text-brand'
      }`}
    >
      📄 {loading ? '여는 중…' : error ? '오류 · 재시도' : '사업소개서 보기'}
    </button>
  );
}

/** 참고 링크(홈페이지·웹 IR) — 새 탭으로 연다. */
function HomepageLink({ homepage }: { homepage: string | null }) {
  if (!homepage) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-neutral-base/45">
        🔗 참고 링크 없음
      </span>
    );
  }
  return (
    <a
      href={normalizeUrl(homepage)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-neutral-base transition-colors hover:border-brand hover:text-brand"
      title={homepage}
    >
      🔗 <span className="truncate">{homepage}</span> ↗
    </a>
  );
}
