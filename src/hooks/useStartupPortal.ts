import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { participantClient } from '@/lib/participantClient';
import {
  createSignedUrlsWithClient,
  uploadParticipantFileWithClient,
} from '@/lib/storage';
import type { EventRow } from '@/types/event';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

/**
 * 스타트업 예약 포탈 데이터 (page_startup_booking.md).
 * 참가자 커스텀 JWT 경로이므로 모든 쿼리/RPC 는 participantClient 를 쓴다(운영진 supabase 와 분리).
 * 조회는 RLS 가 본인 참가 행사로 자동 제한하고, 쓰기는 book/change/cancel RPC 가 최종 검증한다.
 */

/** 포탈에서 쓰는 events 컬럼(목록 카드 + 예약 가능 판정). */
const EVENT_COLUMNS =
  'id,title,status,status_override,status_override_reason,booking_start,booking_end,' +
  'event_start,event_end,max_sessions_per_startup,allow_startup_self_booking,' +
  'allow_duplicate_expert,satisfaction_policy,timezone,created_at';

/** 슬롯 실시간 갱신 폴링 간격(ms). 예약/취소 즉시 공개 반영. */
export const PORTAL_POLL_MS = 10000;

export const portalKeys = {
  events: ['portal', 'events'] as const,
  experts: (eventId: string) => ['portal', 'experts', eventId] as const,
  tables: (eventId: string) => ['portal', 'tables', eventId] as const,
  slots: (eventId: string) => ['portal', 'slots', eventId] as const,
  proposal: (userId: string) => ['portal', 'proposal', userId] as const,
  links: (userId: string) => ['portal', 'links', userId] as const,
  avatars: (eventId: string, cacheKey: string) =>
    ['portal', 'avatars', eventId, cacheKey] as const,
};

/** 스타트업 본인 소개서(IR) 업로드 현황. */
export interface MyProposal {
  /** 저장된 Storage 객체 경로(`proposals/...`). 미업로드면 null. */
  filePath: string | null;
  /** 업로드한 원본 파일명(users.proposal_file_name, 0068). 없으면 null. */
  fileName: string | null;
  /** 마지막 업로드 시각(0046 트리거). 미업로드면 null. */
  uploadedAt: string | null;
}

/** 스타트업 본인 IR/소개서 업로드 상태(users 본인 행, RLS users_select 허용). */
export function useMyProposal(userId: string) {
  return useQuery<MyProposal>({
    queryKey: portalKeys.proposal(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('users')
        .select('proposal_file_url,proposal_file_name,proposal_uploaded_at')
        .eq('id', userId)
        .maybeSingle<{
          proposal_file_url: string | null;
          proposal_file_name: string | null;
          proposal_uploaded_at: string | null;
        }>();
      if (error) throw error;
      return {
        filePath: data?.proposal_file_url ?? null,
        fileName: data?.proposal_file_name ?? null,
        uploadedAt: data?.proposal_uploaded_at ?? null,
      };
    },
  });
}

/**
 * 스타트업 본인 IR/소개서 업로드·교체·해제.
 * 업로드: Storage(proposals 버킷, 0007 RLS 소유자 허용) → set_my_proposal_file RPC 로 컬럼 갱신.
 *   업로드마다 고유 경로(proposals/{id}/{uuid}.pdf)에 저장하고, 파일명/크기를 함께 넘겨
 *   RPC 가 변경 이력(proposal_uploads)을 타임라인에 적재한다(0052).
 * 해제: 컬럼만 비운다(참조 제거). 과거본은 타임라인 열람을 위해 Storage 에 보존(삭제하지 않음).
 */
export function useSetMyProposal(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      arg: { file: File } | { clear: true; currentPath: string | null },
    ) => {
      if ('file' in arg) {
        const path = await uploadParticipantFileWithClient(
          participantClient,
          'STARTUP',
          userId,
          arg.file,
        );
        const { error } = await participantClient.rpc('set_my_proposal_file', {
          p_file_url: path,
          p_file_name: arg.file.name,
          p_file_size: arg.file.size,
        });
        if (error) throw rpcError(error);
        return;
      }
      const { error } = await participantClient.rpc('set_my_proposal_file', {
        p_file_url: null,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.proposal(userId) }),
  });
}

/** 내가 참가한 활성 행사 목록(RLS 자동 제한). DRAFT/CANCELLED 제외, 행사 시작순. */
export function useMyEvents() {
  return useQuery<EventRow[]>({
    queryKey: portalKeys.events,
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('events')
        .select(EVENT_COLUMNS)
        .is('deleted_at', null)
        .in('status', ['BOOKING', 'ALLOCATION', 'PROGRESS', 'FINISHED'])
        .order('event_start', { ascending: true })
        .returns<EventRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** 마지막 선택 행사 보존 키. 3개 스타트업 화면(예약·자료·안내)이 공유한다. */
const SELECTED_EVENT_KEY = 'yna.startup.selectedEventId';

function readStoredEventId(): string | null {
  try {
    return localStorage.getItem(SELECTED_EVENT_KEY);
  } catch {
    return null;
  }
}

/**
 * 스타트업 3개 화면 공통 행사 선택 상태.
 * 선택한 행사 id 를 localStorage 에 보존해 새로고침·메뉴 이동 간에도 마지막 선택을 유지한다.
 * 저장된 id 가 현재 참가 행사 목록에 없으면 첫 행사로 폴백한다.
 */
export function useSelectedStartupEvent() {
  const eventsQ = useMyEvents();
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const [selectedId, setStored] = useState<string | null>(() => readStoredEventId());

  const setSelectedId = useCallback((id: string | null) => {
    setStored(id);
    try {
      if (id) localStorage.setItem(SELECTED_EVENT_KEY, id);
      else localStorage.removeItem(SELECTED_EVENT_KEY);
    } catch {
      /* 저장 실패 시에도 세션 내 선택은 유지된다. */
    }
  }, []);

  const event = useMemo(
    () => events.find((e) => e.id === selectedId) ?? events[0],
    [events, selectedId],
  );

  return {
    eventsQ,
    events,
    event,
    eventId: event?.id ?? '',
    selectedId,
    setSelectedId,
  };
}

interface ExpertParticipantRow {
  user_id: string;
  default_table_id: string | null;
}
interface ExpertUserRow {
  id: string;
  name: string;
  expert_organization: string | null;
  expert_position: string | null;
  expert_description: string | null;
  profile_image_url: string | null;
}
interface UserFieldRow {
  user_id: string;
  field_id: string;
}
interface FieldRow {
  id: string;
  name: string;
}

/**
 * 행사 참가 전문가 목록 + 프로필·분야·기본 테이블.
 * event_participants(EXPERT) → users(co-participant SELECT) → user_fields + fields 를 병합.
 */
export function useEventExperts(eventId: string) {
  return useQuery<PortalExpert[]>({
    queryKey: portalKeys.experts(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data: parts, error: e1 } = await participantClient
        .from('event_participants')
        .select('user_id,default_table_id')
        .eq('event_id', eventId)
        .eq('participant_type', 'EXPERT')
        .returns<ExpertParticipantRow[]>();
      if (e1) throw e1;
      const expertIds = (parts ?? []).map((p) => p.user_id);
      if (expertIds.length === 0) return [];

      const [usersRes, ufRes, fieldsRes] = await Promise.all([
        participantClient
          .from('users')
          .select(
            'id,name,expert_organization,expert_position,expert_description,profile_image_url',
          )
          .in('id', expertIds)
          .returns<ExpertUserRow[]>(),
        participantClient
          .from('user_fields')
          .select('user_id,field_id')
          .in('user_id', expertIds)
          .returns<UserFieldRow[]>(),
        participantClient.from('fields').select('id,name').returns<FieldRow[]>(),
      ]);
      if (usersRes.error) throw usersRes.error;
      if (ufRes.error) throw ufRes.error;
      if (fieldsRes.error) throw fieldsRes.error;

      const userById = new Map((usersRes.data ?? []).map((u) => [u.id, u]));
      const fieldName = new Map((fieldsRes.data ?? []).map((f) => [f.id, f.name]));
      const fieldsByUser = new Map<string, string[]>();
      for (const uf of ufRes.data ?? []) {
        const name = fieldName.get(uf.field_id);
        if (!name) continue;
        const list = fieldsByUser.get(uf.user_id);
        if (list) list.push(name);
        else fieldsByUser.set(uf.user_id, [name]);
      }

      return (parts ?? []).map((p) => {
        const u = userById.get(p.user_id);
        return {
          userId: p.user_id,
          name: u?.name ?? '(알 수 없는 전문가)',
          organization: u?.expert_organization ?? null,
          position: u?.expert_position ?? null,
          description: u?.expert_description ?? null,
          defaultTableId: p.default_table_id,
          fieldNames: fieldsByUser.get(p.user_id) ?? [],
          profileImageUrl: u?.profile_image_url ?? null,
        } satisfies PortalExpert;
      });
    },
  });
}

/**
 * 전문가 프로필 사진의 단기 Signed URL 일괄 조회(avatars 버킷, participantClient).
 * 반환은 전문가 userId → URL 맵. 사진 미등록 전문가는 누락(카드에서 이니셜 대체).
 * 슬롯 폴링과 분리된 쿼리라 10초마다 재호출하지 않는다(URL 만료 전까지 캐시).
 */
export function useExpertAvatars(eventId: string, experts: PortalExpert[]) {
  const withPhoto = experts
    .map((e) => ({ id: e.userId, path: e.profileImageUrl }))
    .filter((x): x is { id: string; path: string } => Boolean(x.path));
  const cacheKey = withPhoto
    .map((p) => `${p.id}:${p.path}`)
    .sort()
    .join('|');

  return useQuery<Map<string, string>>({
    queryKey: portalKeys.avatars(eventId, cacheKey),
    enabled: withPhoto.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const byPath = await createSignedUrlsWithClient(
        participantClient,
        withPhoto.map((p) => p.path),
        60 * 60,
      );
      const map = new Map<string, string>();
      for (const { id, path } of withPhoto) {
        const url = byPath.get(path);
        if (url) map.set(id, url);
      }
      return map;
    },
  });
}

/** 행사장 테이블 정보(코드 + 상세 위치). */
export interface EventTableInfo {
  code: string;
  /** 테이블 상세 위치/설명(event_tables.description). 없으면 null. */
  description: string | null;
}

/** 행사장 테이블 맵(슬롯 위치 표기용). id→{code, description}. */
export function useEventTableCodes(eventId: string) {
  return useQuery<Map<string, EventTableInfo>>({
    queryKey: portalKeys.tables(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('event_tables')
        .select('id,table_code,description')
        .eq('event_id', eventId)
        .returns<{ id: string; table_code: string; description: string | null }[]>();
      if (error) throw error;
      return new Map(
        (data ?? []).map((t) => [t.id, { code: t.table_code, description: t.description }]),
      );
    },
  });
}

/** 행사 매칭 슬롯 목록(시간순). 폴링으로 타 기업의 예약/취소를 근실시간 반영. */
export function useEventSlots(eventId: string, opts?: { refetchInterval?: number }) {
  return useQuery<MatchingSlotRow[]>({
    queryKey: portalKeys.slots(eventId),
    enabled: Boolean(eventId),
    refetchInterval: opts?.refetchInterval ?? false,
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('matching_slots')
        .select(
          'id,event_id,expert_id,startup_id,start_time,end_time,table_id,booking_type,session_status,counseling_request',
        )
        .eq('event_id', eventId)
        .order('start_time', { ascending: true })
        .returns<MatchingSlotRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** RPC 예외 메시지(RAISE EXCEPTION 의 한국어 본문)를 사용자 메시지로 전달. */
function rpcError(error: { message: string }): Error {
  return new Error(error.message || '요청을 처리하지 못했습니다.');
}

/** 슬롯 예약 신청 — book_slot RPC(BOOKING 단계, 본인). */
export function useBookSlot(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await participantClient.rpc('book_slot', { p_slot_id: slotId });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.slots(eventId) }),
  });
}

/** 예약 시간 변경 — change_booking RPC(기존 해제 + 신규 예약 단일 트랜잭션). */
export function useChangeBooking(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fromSlotId, toSlotId }: { fromSlotId: string; toSlotId: string }) => {
      const { error } = await participantClient.rpc('change_booking', {
        p_from_slot_id: fromSlotId,
        p_to_slot_id: toSlotId,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.slots(eventId) }),
  });
}

/** 예약 취소 — cancel_booking RPC(슬롯 즉시 공개, 사유 선택). */
export function useCancelBooking(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, reason }: { slotId: string; reason?: string | null }) => {
      const { error } = await participantClient.rpc('cancel_booking', {
        p_slot_id: slotId,
        p_reason: reason?.trim() ? reason.trim() : null,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.slots(eventId) }),
  });
}

/** 상담 희망사항 저장 — set_counseling_request RPC(본인 예약 슬롯, 0066). */
export function useSetCounselingRequest(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, request }: { slotId: string; request: string }) => {
      const { error } = await participantClient.rpc('set_counseling_request', {
        p_slot_id: slotId,
        p_request: request,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.slots(eventId) }),
  });
}

/** 스타트업 본인 참고 URL 링크 1건(company_links, 0073). */
export interface CompanyLink {
  id: string;
  url: string;
  /** 부연설명(선택). 없으면 null. */
  label: string | null;
  createdAt: string;
}

/** 스타트업 본인 참고 URL 목록(company_links, RLS 본인 SELECT). 등록순. */
export function useMyCompanyLinks(userId: string) {
  return useQuery<CompanyLink[]>({
    queryKey: portalKeys.links(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('company_links')
        .select('id,url,label,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .returns<{ id: string; url: string; label: string | null; created_at: string }[]>();
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        url: r.url,
        label: r.label,
        createdAt: r.created_at,
      }));
    },
  });
}

/** 참고 URL 추가 — add_my_company_link RPC(0073). 대표 URL(company_homepage) 자동 동기화. */
export function useAddCompanyLink(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ url, label }: { url: string; label: string }) => {
      const { error } = await participantClient.rpc('add_my_company_link', {
        p_url: url,
        p_label: label || null,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.links(userId) }),
  });
}

/** 참고 URL 삭제 — delete_my_company_link RPC(0073). */
export function useDeleteCompanyLink(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await participantClient.rpc('delete_my_company_link', {
        p_id: id,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.links(userId) }),
  });
}
