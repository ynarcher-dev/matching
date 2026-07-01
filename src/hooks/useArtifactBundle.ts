import { useMutation } from '@tanstack/react-query';
import JSZip from 'jszip';
import { supabase } from '@/lib/supabaseClient';
import { buildWorkbookBuffer } from '@/lib/excel';
import { PHOTO_BUCKET } from '@/lib/companyPhoto';
import { buildCounselingSheet, buildSurveySheet } from '@/lib/eventExport';
import {
  filterCounselingLogs,
  filterEventResponses,
  filterExpertResponses,
  buildArtifactSummarySheet,
  buildExpertSurveySheet,
  companyFolderName,
  bundlePhotoName,
  bundleFilename,
  type BundleCompany,
} from '@/lib/artifactBundle';
import { formatDate } from '@/lib/datetime';
import type { AssignableUser } from '@/types/eventDetail';
import type { SurveyQuestion, SurveyAnswerRow } from '@/types/satisfaction';
import type { CounselingQuestion, CounselingAnswerRow } from '@/types/counselingLog';
import type { ReportCounselingLog } from '@/hooks/useCounselingReport';
import type { ReportResponse } from '@/hooks/useSurveyReport';
import type { ExpertResponse } from '@/lib/expertSurveyReport';

/**
 * 산출물 일괄 다운로드(ZIP) (docs/artifact_management_ideation.md, operator supabase).
 * 선택 기업의 상담일지·행사만족도·전문가만족도를 하나의 데이터 엑셀로 묶고, 증빙사진은
 * 원본 이미지로 받아 `사진/{기업명}/` 폴더에 담아 ZIP 으로 내려준다(사진 없으면 데이터만).
 * 데이터 시트는 행사 결과 엑셀 내보내기(lib/eventExport) 빌더를 선택 기업으로 한정해 재사용한다.
 */

interface RawLog {
  follow_up_required: boolean;
  follow_up_memo: string | null;
  submitted_at: string | null;
  is_public: boolean;
  counseling_log_answers: CounselingAnswerRow[] | null;
}
interface RawSlotRow {
  id: string;
  expert_id: string | null;
  startup_id: string | null;
  start_time: string;
  end_time: string;
  session_status: string;
  counseling_logs: RawLog | RawLog[] | null;
}
interface RawSurveyRow {
  id: string;
  user_id: string;
  user_role: 'STARTUP' | 'EXPERT';
  submitted_at: string;
  survey_answers: SurveyAnswerRow[] | null;
}
interface RawExpertRow {
  id: string;
  user_id: string;
  target_expert_id: string;
  slot_id: string;
  submitted_at: string;
  survey_answers: SurveyAnswerRow[] | null;
}
interface PhotoRow {
  company_user_id: string;
  storage_path: string;
  original_file_name: string | null;
  created_at: string;
}

export interface ArtifactBundleParams {
  companies: BundleCompany[];
  userById: Map<string, AssignableUser>;
}

/** 한 슬롯 행을 상담일지 리포트 형태로 평탄화. */
function toReportLog(r: RawSlotRow): ReportCounselingLog {
  const log = Array.isArray(r.counseling_logs) ? r.counseling_logs[0] : r.counseling_logs;
  return {
    id: r.id,
    submitted_at: log?.submitted_at ?? null,
    follow_up_required: log?.follow_up_required ?? false,
    follow_up_memo: log?.follow_up_memo ?? null,
    is_public: log?.is_public ?? false,
    expert_id: r.expert_id,
    startup_id: r.startup_id,
    start_time: r.start_time,
    end_time: r.end_time,
    session_status: r.session_status,
    answers: log?.counseling_log_answers ?? [],
  };
}

export function useArtifactBundle(
  eventId: string,
  eventTitle: string,
  timezone: string,
  eventStart: string,
) {
  return useMutation({
    mutationFn: async ({ companies, userById }: ArtifactBundleParams) => {
      if (companies.length === 0) throw new Error('선택된 기업이 없습니다.');
      // 파일명 {행사일자} — 행사 시작일(행사 timezone 기준 YYYY-MM-DD).
      const eventDate = formatDate(eventStart, timezone);
      const ids = new Set(companies.map((c) => c.userId));
      const companyIds = [...ids];

      // 1) 데이터 조회(상담일지·만족도·문항·사진). 결과 리포트 화면과 동일 경로(ADMIN RLS).
      const [slotsR, eventRespR, expertRespR, surveyQR, counselingQR, photosR] = await Promise.all([
        supabase
          .from('matching_slots')
          .select(
            'id,expert_id,startup_id,start_time,end_time,session_status,' +
              'counseling_logs(submitted_at,follow_up_required,follow_up_memo,is_public,' +
              'counseling_log_answers(question_id,answer_text,answer_rating,answer_selections))',
          )
          .eq('event_id', eventId)
          .not('startup_id', 'is', null)
          .neq('session_status', 'CANCELLED'),
        supabase
          .from('survey_responses')
          .select('id,user_id,user_role,submitted_at,survey_answers(question_id,answer_text,answer_rating,answer_selections)')
          .eq('event_id', eventId)
          .eq('survey_scope', 'EVENT')
          .order('submitted_at', { ascending: false }),
        supabase
          .from('survey_responses')
          .select('id,user_id,target_expert_id,slot_id,submitted_at,survey_answers(question_id,answer_text,answer_rating,answer_selections)')
          .eq('event_id', eventId)
          .eq('survey_scope', 'EXPERT')
          .order('submitted_at', { ascending: false }),
        supabase
          .from('survey_questions')
          .select('id,event_id,survey_scope,target_role,question_type,title,description,options,is_required,order_no')
          .eq('event_id', eventId)
          .returns<SurveyQuestion[]>(),
        supabase
          .from('counseling_log_questions')
          .select('id,event_id,question_type,title,description,options,is_required,order_no,system_key')
          .eq('event_id', eventId)
          .returns<CounselingQuestion[]>(),
        supabase
          .from('company_photos')
          .select('company_user_id,storage_path,original_file_name,created_at')
          .eq('event_id', eventId)
          .is('deleted_at', null)
          .in('company_user_id', companyIds)
          .order('created_at', { ascending: true })
          .returns<PhotoRow[]>(),
      ]);

      for (const r of [slotsR, eventRespR, expertRespR, surveyQR, counselingQR, photosR]) {
        if (r.error) throw r.error;
      }

      // 2) 선택 기업으로 필터.
      const allLogs = ((slotsR.data as unknown as RawSlotRow[] | null) ?? [])
        .map(toReportLog)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      const logs = filterCounselingLogs(allLogs, ids);

      const eventResponses: ReportResponse[] = ((eventRespR.data as RawSurveyRow[] | null) ?? []).map(
        (r) => ({
          id: r.id,
          user_id: r.user_id,
          user_role: r.user_role,
          submitted_at: r.submitted_at,
          answers: r.survey_answers ?? [],
        }),
      );
      const eventFiltered = filterEventResponses(eventResponses, ids);

      const expertResponses: ExpertResponse[] = ((expertRespR.data as RawExpertRow[] | null) ?? []).map(
        (r) => ({
          id: r.id,
          user_id: r.user_id,
          target_expert_id: r.target_expert_id,
          slot_id: r.slot_id,
          submitted_at: r.submitted_at,
          answers: r.survey_answers ?? [],
        }),
      );
      const expertFiltered = filterExpertResponses(expertResponses, ids);

      const allQuestions = surveyQR.data ?? [];
      const eventQuestions = allQuestions.filter((q) => q.survey_scope === 'EVENT');
      const expertQuestions = allQuestions.filter((q) => q.survey_scope === 'EXPERT');

      const photos = photosR.data ?? [];
      const photosByCompany = new Map<string, PhotoRow[]>();
      const photoCountByCompany = new Map<string, number>();
      for (const p of photos) {
        const arr = photosByCompany.get(p.company_user_id) ?? [];
        arr.push(p);
        photosByCompany.set(p.company_user_id, arr);
        photoCountByCompany.set(p.company_user_id, (photoCountByCompany.get(p.company_user_id) ?? 0) + 1);
      }

      // 3) 데이터 워크북(요약·상담일지·행사만족도·전문가만족도).
      const sheets = [
        buildArtifactSummarySheet({
          eventTitle,
          companies,
          photoCountByCompany,
          counselingCount: logs.length,
          eventSurveyCount: eventFiltered.length,
          expertSurveyCount: expertFiltered.length,
        }),
        buildCounselingSheet(counselingQR.data ?? [], logs, userById, timezone),
        buildSurveySheet(eventQuestions, eventFiltered, userById, timezone),
        buildExpertSurveySheet(expertQuestions, expertFiltered, userById, timezone),
      ];
      const dataBuffer = await buildWorkbookBuffer(sheets);

      // 4) ZIP 구성: 데이터 엑셀 + 사진 폴더(사진 있는 기업만).
      const zip = new JSZip();
      zip.file('산출물_데이터.xlsx', dataBuffer);

      // 폴더명 중복 방지(같은 기업명) — userId 앞 4자 접미.
      // 사진이 한 장도 없으면 사진 폴더 자체를 만들지 않는다(데이터 엑셀만).
      const usedFolders = new Set<string>();
      let photoFailures = 0;
      let photosRoot: JSZip | null = null;
      for (const company of companies) {
        const list = photosByCompany.get(company.userId) ?? [];
        if (list.length === 0) continue;
        if (!photosRoot) photosRoot = zip.folder('사진')!;
        let folder = companyFolderName(company);
        if (usedFolders.has(folder.toLowerCase())) folder = `${folder} (${company.userId.slice(0, 4)})`;
        usedFolders.add(folder.toLowerCase());
        const dir = photosRoot.folder(folder)!;

        const usedNames = new Set<string>();
        const downloaded = await Promise.all(
          list.map(async (p) => {
            const objectKey = p.storage_path.slice(PHOTO_BUCKET.length + 1);
            const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(objectKey);
            if (error || !data) return null;
            return { blob: data, photo: p };
          }),
        );
        downloaded.forEach((d) => {
          if (!d) {
            photoFailures += 1;
            return;
          }
          const name = bundlePhotoName({
            used: usedNames,
            companyName: company.companyName,
            eventTitle,
            eventDate,
            storagePath: d.photo.storage_path,
            originalName: d.photo.original_file_name,
          });
          dir.file(name, d.blob);
        });
      }

      // 5) 압축 → 다운로드.
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const dateStr = new Date().toISOString().slice(0, 10);
      triggerDownload(zipBlob, bundleFilename(eventTitle, dateStr));

      return { companyCount: companies.length, photoCount: photos.length, photoFailures };
    },
  });
}

/** Blob 을 파일 다운로드로 트리거(브라우저). */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
