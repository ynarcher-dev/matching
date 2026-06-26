import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { downloadSheets } from '@/lib/excel';
import {
  buildEventExportSheets,
  exportFilename,
  type EventExportBundle,
  type RosterUser,
} from '@/lib/eventExport';
import type {
  AssignableUser,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';
import type { AttendanceLogRow } from '@/types/attendance';
import type { CounselingQuestion } from '@/types/counselingLog';
import type { SurveyQuestion, SurveyAnswerRow } from '@/types/satisfaction';
import type { CounselingAnswerRow } from '@/types/counselingLog';
import type { ReportCounselingLog } from '@/hooks/useCounselingReport';
import type { ReportResponse } from '@/hooks/useSurveyReport';

/**
 * 행사 결과 엑셀(xlsx) 내보내기 (Phase 7 슬라이스 3, operator supabase).
 * 버튼 클릭 시 필요한 데이터를 즉시 조회해 5개 시트 워크북을 만들어 다운로드한다.
 * 집계/변환은 lib/eventExport(순수 함수), 직렬화·다운로드는 lib/excel 이 담당한다.
 * 모든 조회는 ADMIN RLS 로 보호된 테이블 직접 SELECT(상담/만족도 결과 리포트와 동일 경로).
 */

const USER_COLUMNS =
  'id,role,name,email,phone_number,company_name,representative_name,contact_name,' +
  'expert_organization,expert_position';

interface RawCounselingSlot {
  id: string;
  event_id: string;
  expert_id: string | null;
  startup_id: string | null;
  start_time: string;
  session_status: string;
}

interface RawCounselingRow {
  id: string;
  submitted_at: string | null;
  follow_up_required: boolean;
  follow_up_memo: string | null;
  is_public: boolean;
  matching_slots: RawCounselingSlot | RawCounselingSlot[] | null;
  counseling_log_answers: CounselingAnswerRow[] | null;
}

interface RawSurveyRow {
  id: string;
  user_id: string;
  user_role: 'STARTUP' | 'EXPERT';
  submitted_at: string;
  survey_answers: SurveyAnswerRow[] | null;
}

async function fetchBundle(eventId: string, timezone: string): Promise<EventExportBundle> {
  const [slotsR, tablesR, participantsR, surveyQR, counselingQR] = await Promise.all([
    supabase
      .from('matching_slots')
      .select('id,event_id,expert_id,startup_id,start_time,end_time,table_id,booking_type,session_status')
      .eq('event_id', eventId)
      .order('start_time', { ascending: true })
      .returns<MatchingSlotRow[]>(),
    supabase
      .from('event_tables')
      .select('id,event_id,table_code,description,is_active')
      .eq('event_id', eventId)
      .returns<EventTable[]>(),
    supabase
      .from('event_participants')
      .select('user_id')
      .eq('event_id', eventId)
      .returns<{ user_id: string }[]>(),
    supabase
      .from('survey_questions')
      .select('id,event_id,target_role,question_type,title,description,options,is_required,order_no')
      .eq('event_id', eventId)
      .returns<SurveyQuestion[]>(),
    supabase
      .from('counseling_log_questions')
      .select('id,event_id,question_type,title,description,options,is_required,order_no,system_key')
      .eq('event_id', eventId)
      .returns<CounselingQuestion[]>(),
  ]);

  for (const r of [slotsR, tablesR, participantsR, surveyQR, counselingQR]) {
    if (r.error) throw r.error;
  }

  const slots = slotsR.data ?? [];
  const slotIds = slots.map((s) => s.id);
  const userIds = (participantsR.data ?? []).map((p) => p.user_id);

  const [usersR, attendanceR, counselingLogsR, surveyRespR] = await Promise.all([
    userIds.length
      ? supabase.from('users').select(USER_COLUMNS).in('id', userIds).returns<RosterUser[]>()
      : Promise.resolve({ data: [] as RosterUser[], error: null }),
    slotIds.length
      ? supabase
          .from('attendance_logs')
          .select('id,matching_slot_id,user_id,role_type,attendance_status,checked_in_at')
          .in('matching_slot_id', slotIds)
          .returns<AttendanceLogRow[]>()
      : Promise.resolve({ data: [] as AttendanceLogRow[], error: null }),
    supabase
      .from('counseling_logs')
      .select(
        'id,submitted_at,follow_up_required,follow_up_memo,is_public,' +
          'matching_slots!inner(id,event_id,expert_id,startup_id,start_time,session_status),' +
          'counseling_log_answers(question_id,answer_text,answer_rating,answer_selections)',
      )
      .eq('matching_slots.event_id', eventId),
    supabase
      .from('survey_responses')
      .select(
        'id,user_id,user_role,submitted_at,survey_answers(question_id,answer_text,answer_rating,answer_selections)',
      )
      .eq('event_id', eventId)
      .order('submitted_at', { ascending: false }),
  ]);

  for (const r of [usersR, attendanceR, counselingLogsR, surveyRespR]) {
    if (r.error) throw r.error;
  }

  const roster = (usersR.data ?? []) as RosterUser[];
  const userById = new Map<string, AssignableUser>(
    roster.map((u) => [
      u.id,
      {
        id: u.id,
        name: u.name,
        role: u.role,
        company_name: u.company_name,
        representative_name: u.representative_name,
        expert_organization: u.expert_organization,
        expert_position: u.expert_position,
      },
    ]),
  );

  const counselingLogs: ReportCounselingLog[] = ((counselingLogsR.data as unknown as RawCounselingRow[] | null) ?? [])
    .map((r) => {
      const slot = Array.isArray(r.matching_slots) ? r.matching_slots[0] : r.matching_slots;
      return {
        id: r.id,
        submitted_at: r.submitted_at,
        follow_up_required: r.follow_up_required,
        follow_up_memo: r.follow_up_memo,
        is_public: r.is_public,
        expert_id: slot?.expert_id ?? null,
        startup_id: slot?.startup_id ?? null,
        start_time: slot?.start_time ?? '',
        session_status: slot?.session_status ?? '',
        answers: r.counseling_log_answers ?? [],
      } satisfies ReportCounselingLog;
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const surveyResponses: ReportResponse[] = ((surveyRespR.data as RawSurveyRow[] | null) ?? []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_role: r.user_role,
    submitted_at: r.submitted_at,
    answers: r.survey_answers ?? [],
  }));

  return {
    timezone,
    slots,
    tables: tablesR.data ?? [],
    userById,
    attendanceLogs: attendanceR.data ?? [],
    counselingQuestions: counselingQR.data ?? [],
    counselingLogs,
    surveyQuestions: surveyQR.data ?? [],
    surveyResponses,
    roster,
  };
}

/** 엑셀 내보내기 액션. exportExcel({ title }) 호출 시 조회→워크북→다운로드. */
export function useEventExport(eventId: string, timezone: string) {
  return useMutation({
    mutationFn: async ({ title }: { title: string }) => {
      const bundle = await fetchBundle(eventId, timezone);
      const sheets = buildEventExportSheets(bundle);
      const dateStr = new Date().toISOString().slice(0, 10);
      await downloadSheets(sheets, exportFilename(title, dateStr));
    },
  });
}
