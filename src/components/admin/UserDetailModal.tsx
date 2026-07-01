import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { TextField } from '@/components/common/TextField';
import { SelectField } from '@/components/common/SelectField';
import { Alert } from '@/components/common/Alert';
import { FieldTagInput } from '@/components/admin/FieldTagInput';
import { ParticipantFileInput } from '@/components/admin/ParticipantFileInput';
import { ExpertAvatarField } from '@/components/admin/ExpertAvatarField';
import { ProposalHistoryTimeline } from '@/components/admin/ProposalHistoryTimeline';
import { participantFormSchema } from '@/schemas/userSchemas';
import type { ParticipantFormValues } from '@/schemas/userSchemas';
import { useSaveParticipant } from '@/hooks/useUserMutations';
import { PARTICIPANT_ROLE_LABELS } from '@/lib/labels';
import type { ParticipantRole } from '@/types/user';

export interface EditableParticipant {
  id: string;
  role: ParticipantRole;
  name: string;
  email: string;
  phone_number: string | null;
  company_name: string | null;
  representative_name: string | null;
  contact_name: string | null;
  company_homepage: string | null;
  company_description: string | null;
  expert_organization: string | null;
  expert_position: string | null;
  expert_description: string | null;
  proposal_file_url: string | null;
  profile_image_url: string | null;
  field_ids: string[];
}

interface UserDetailModalProps {
  open: boolean;
  onClose: () => void;
  /** 지정 시 편집 모드, 미지정 시 신규 등록 모드. */
  user?: EditableParticipant | null;
  /** 신규 등록 시 기본 역할(활성 탭). */
  defaultRole: ParticipantRole;
}

const ROLE_OPTIONS = [
  { value: 'STARTUP', label: PARTICIPANT_ROLE_LABELS.STARTUP },
  { value: 'EXPERT', label: PARTICIPANT_ROLE_LABELS.EXPERT },
];

function buildDefaults(
  user: EditableParticipant | null | undefined,
  defaultRole: ParticipantRole,
): ParticipantFormValues {
  return {
    role: user?.role ?? defaultRole,
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone_number: user?.phone_number ?? '',
    company_name: user?.company_name ?? '',
    representative_name: user?.representative_name ?? '',
    contact_name: user?.contact_name ?? '',
    company_homepage: user?.company_homepage ?? '',
    company_description: user?.company_description ?? '',
    expert_organization: user?.expert_organization ?? '',
    expert_position: user?.expert_position ?? '',
    expert_description: user?.expert_description ?? '',
    field_ids: user?.field_ids ?? [],
  };
}

/**
 * 참가자 개별 등록/수정 폼 (page_admin_user_management.md §1.2, §2.4).
 * 역할에 따라 스타트업/전문가 전용 필드 + 첨부(소개서/프로필)를 전환하고, 관심/전문 분야(최대 3)를 관리한다.
 */
export function UserDetailModal({ open, onClose, user, defaultRole }: UserDetailModalProps) {
  const isEdit = Boolean(user);
  const save = useSaveParticipant();

  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantFormSchema),
    defaultValues: buildDefaults(user, defaultRole),
  });

  useEffect(() => {
    if (open) {
      reset(buildDefaults(user, defaultRole));
      setFile(null);
      setRemoveFile(false);
    }
  }, [open, user, defaultRole, reset]);

  const role = watch('role');
  const fieldIds = watch('field_ids');

  // 현재 저장된 첨부 경로(역할 기준). 역할을 바꾸면 다른 버킷이므로 같은 역할일 때만 노출.
  const currentFilePath =
    user && user.role === role
      ? role === 'STARTUP'
        ? user.proposal_file_url
        : user.profile_image_url
      : null;

  const onSubmit = handleSubmit((values) => {
    save.mutate(
      {
        id: user?.id,
        values,
        file,
        removeFile,
        currentFilePath,
      },
      { onSuccess: () => onClose() },
    );
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '참가자 정보 수정' : '참가자 추가'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            취소
          </Button>
          <Button type="submit" form="user-form" loading={save.isPending}>
            {isEdit ? '저장' : '등록'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {save.error && <Alert tone="error">{(save.error as Error).message}</Alert>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="역할"
            options={ROLE_OPTIONS}
            error={errors.role?.message}
            {...register('role')}
          />
          <TextField label="이름" error={errors.name?.message} {...register('name')} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="이메일"
            type="email"
            placeholder="login@example.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label="연락처(휴대전화)"
            placeholder="01012345678"
            error={errors.phone_number?.message}
            {...register('phone_number')}
          />
        </div>

        {role === 'STARTUP' ? (
          <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-neutral-base">스타트업 정보</legend>
            <TextField label="기업명" error={errors.company_name?.message} {...register('company_name')} />
            <TextField
              label="대표자명"
              error={errors.representative_name?.message}
              {...register('representative_name')}
            />
            <TextField
              label="담당자명"
              error={errors.contact_name?.message}
              {...register('contact_name')}
            />
            <TextField
              label="홈페이지"
              error={errors.company_homepage?.message}
              {...register('company_homepage')}
            />
            <div className="sm:col-span-2">
              <TextField
                label="기업 소개"
                error={errors.company_description?.message}
                {...register('company_description')}
              />
            </div>
          </fieldset>
        ) : (
          <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-neutral-base">전문가 정보</legend>
            <TextField
              label="소속"
              error={errors.expert_organization?.message}
              {...register('expert_organization')}
            />
            <TextField
              label="직책"
              error={errors.expert_position?.message}
              {...register('expert_position')}
            />
            <div className="sm:col-span-2">
              <TextField
                label="전문가 소개"
                error={errors.expert_description?.message}
                {...register('expert_description')}
              />
            </div>
          </fieldset>
        )}

        <FieldTagInput
          value={fieldIds ?? []}
          onChange={(next) => setValue('field_ids', next, { shouldValidate: true })}
          error={errors.field_ids?.message}
        />

        {/* 첨부: 스타트업=사업소개서 PDF, 전문가=프로필 사진(원형 미리보기·기본 사람 아이콘). */}
        {role === 'STARTUP' ? (
          <ParticipantFileInput
            role={role}
            currentPath={currentFilePath}
            userId={user?.id ?? null}
            file={file}
            onFileChange={setFile}
            removeRequested={removeFile}
            onRemoveChange={setRemoveFile}
          />
        ) : (
          <ExpertAvatarField
            currentPath={currentFilePath}
            file={file}
            onFileChange={setFile}
            removeRequested={removeFile}
            onRemoveChange={setRemoveFile}
          />
        )}

        {/* 소개서 변경 이력 타임라인(편집 중인 기존 스타트업 한정). */}
        {isEdit && role === 'STARTUP' && user && <ProposalHistoryTimeline userId={user.id} />}
      </form>
    </Modal>
  );
}
