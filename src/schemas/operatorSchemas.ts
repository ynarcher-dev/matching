import { z } from 'zod';
import { superAdminRoleConflict } from '@/lib/operator';

/**
 * 운영자 생성/수정 폼 스키마 (page_admin_operator_permissions.md 4.2).
 * 최고관리자 체크는 ADMIN 역할에서만 허용(superRefine).
 */
export const operatorFormSchema = z
  .object({
    email: z.string().trim().email('올바른 이메일을 입력해 주세요.'),
    name: z.string().trim().min(1, '이름을 입력해 주세요.').max(100, '이름이 너무 깁니다.'),
    role: z.enum(['ADMIN', 'STAFF']),
    is_super_admin: z.boolean(),
    /** 생성 시 비밀번호 전달 방식(수정 시 무시). */
    password_mode: z.enum(['temp_password', 'invite']),
    reason: z.string().trim().min(1, '사유를 입력해 주세요.').max(500, '사유가 너무 깁니다.'),
  })
  .superRefine((v, ctx) => {
    if (superAdminRoleConflict(v.role, v.is_super_admin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['is_super_admin'],
        message: '최고관리자 권한은 관리자(ADMIN) 역할에만 부여할 수 있습니다.',
      });
    }
  });

export type OperatorFormValues = z.infer<typeof operatorFormSchema>;
