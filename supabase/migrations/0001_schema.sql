-- =============================================================================
-- 0001_schema.sql — 코어 테이블 DDL (15개 테이블)
-- 출처: docs/db_schema.md 3장. 본 파일은 명세 DDL을 그대로 반영하고
--       성능/정합성 보조 인덱스를 말미에 추가한다.
-- =============================================================================

-- UUID 생성 및 비밀번호(Access Code) 해시 함수 사용
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. 행사 테이블
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    status_override BOOLEAN NOT NULL DEFAULT FALSE,
    status_override_reason TEXT,
    status_overridden_at TIMESTAMP WITH TIME ZONE,
    booking_start TIMESTAMP WITH TIME ZONE NOT NULL,
    booking_end TIMESTAMP WITH TIME ZONE NOT NULL,
    event_start TIMESTAMP WITH TIME ZONE NOT NULL,
    event_end TIMESTAMP WITH TIME ZONE NOT NULL,
    max_sessions_per_startup INT NOT NULL DEFAULT 3,
    allow_startup_self_booking BOOLEAN NOT NULL DEFAULT FALSE,
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Seoul',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_events_status CHECK (status IN ('DRAFT', 'BOOKING', 'ALLOCATION', 'PROGRESS', 'FINISHED', 'CANCELLED')),
    CONSTRAINT chk_booking_dates CHECK (booking_start < booking_end),
    CONSTRAINT chk_event_dates CHECK (event_start < event_end),
    CONSTRAINT chk_booking_limit CHECK (booking_end <= event_start),
    CONSTRAINT chk_max_sessions CHECK (max_sessions_per_startup > 0)
);

-- 2. 사용자 테이블
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'STARTUP',
    auth_user_id UUID UNIQUE,
    access_code_hash TEXT,
    access_code_issued_at TIMESTAMP WITH TIME ZONE,
    session_version INT NOT NULL DEFAULT 1,
    phone_number VARCHAR(50),
    company_name VARCHAR(255),
    representative_name VARCHAR(100),
    contact_name VARCHAR(100),
    company_description TEXT,
    company_homepage VARCHAR(255),
    proposal_file_url VARCHAR(512),
    profile_image_url VARCHAR(512),
    expert_organization VARCHAR(255),
    expert_position VARCHAR(100),
    expert_description TEXT,
    is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_users_role CHECK (role IN ('ADMIN', 'STAFF', 'EXPERT', 'STARTUP'))
);

-- status_overridden_by 는 users 가 생성된 뒤에 FK 로 추가한다.
ALTER TABLE public.events
    ADD COLUMN status_overridden_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 소프트 삭제 고려 이메일 부분 유니크 인덱스
CREATE UNIQUE INDEX users_active_email_idx ON public.users (email) WHERE deleted_at IS NULL;

-- 3. 분야 마스터 테이블
CREATE TABLE public.fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL
);

-- 4. 사용자별 기본 분야 테이블
CREATE TABLE public.user_fields (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    field_id UUID REFERENCES public.fields(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, field_id)
);

-- 5. 행사 테이블 마스터
CREATE TABLE public.event_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    table_code VARCHAR(50) NOT NULL,
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT unique_event_table_code UNIQUE(event_id, table_code)
);

-- 6. 행사 참가 관계 테이블
CREATE TABLE public.event_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    participant_type VARCHAR(50) NOT NULL,
    default_table_id UUID REFERENCES public.event_tables(id) ON DELETE SET NULL,
    CONSTRAINT unique_event_participant UNIQUE(event_id, user_id),
    CONSTRAINT chk_participant_type CHECK (participant_type IN ('EXPERT', 'STARTUP'))
);

-- 7. 행사별 참가 분야 테이블
CREATE TABLE public.event_participant_fields (
    event_participant_id UUID REFERENCES public.event_participants(id) ON DELETE CASCADE,
    field_id UUID REFERENCES public.fields(id) ON DELETE CASCADE,
    PRIMARY KEY (event_participant_id, field_id)
);

-- 8. 매칭 슬롯 테이블
CREATE TABLE public.matching_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    expert_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    startup_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    table_id UUID REFERENCES public.event_tables(id) ON DELETE SET NULL,
    booking_type VARCHAR(50) NOT NULL DEFAULT 'NONE',
    session_status VARCHAR(50) NOT NULL DEFAULT 'WAITING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_slot_dates CHECK (start_time < end_time),
    CONSTRAINT chk_booking_type CHECK (booking_type IN ('NONE', 'MANUAL', 'AUTO_AI', 'ADMIN_FORCE')),
    CONSTRAINT chk_session_status CHECK (session_status IN ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED'))
);

-- 9. 상담일지 및 평가지 테이블
CREATE TABLE public.counseling_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matching_slot_id UUID UNIQUE REFERENCES public.matching_slots(id) ON DELETE CASCADE,
    score_technology INT CHECK (score_technology BETWEEN 1 AND 5),
    score_expertise INT CHECK (score_expertise BETWEEN 1 AND 5),
    score_reliability INT CHECK (score_reliability BETWEEN 1 AND 5),
    score_collaboration INT CHECK (score_collaboration BETWEEN 1 AND 5),
    score_probability INT CHECK (score_probability BETWEEN 1 AND 5),
    content TEXT,
    follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
    follow_up_memo TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE
    -- 코멘트 최소 글자 수 제한 없음(임시저장 허용). 최종 제출 검증은 RPC 에서 처리.
);

-- 10. 예약 거래 이력 테이블
CREATE TABLE public.booking_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matching_slot_id UUID REFERENCES public.matching_slots(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL,
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    startup_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    expert_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    previous_slot_info JSONB,
    new_slot_info JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_action_type CHECK (action_type IN ('CREATED', 'CHANGED', 'CANCELLED', 'NO_SHOW'))
);

-- 11. 실시간 출석체크 로그 테이블
CREATE TABLE public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matching_slot_id UUID REFERENCES public.matching_slots(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    role_type VARCHAR(50) NOT NULL,
    attendance_status VARCHAR(50) NOT NULL,
    check_in_type VARCHAR(50) NOT NULL,
    checked_in_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    checked_in_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reason TEXT,
    CONSTRAINT chk_role_type CHECK (role_type IN ('EXPERT', 'STARTUP')),
    CONSTRAINT chk_attendance_status CHECK (attendance_status IN ('PRESENT', 'ABSENT')),
    CONSTRAINT chk_check_in_type CHECK (check_in_type IN ('QR', 'MANUAL'))
);

-- 12. AI 자동 배치 제안 테이블
CREATE TABLE public.matching_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    target_slot_id UUID REFERENCES public.matching_slots(id) ON DELETE CASCADE,
    startup_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    score NUMERIC(6,2) NOT NULL DEFAULT 0,
    field_matched BOOLEAN NOT NULL DEFAULT FALSE,
    unmatched_reason VARCHAR(100),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_proposal_slot UNIQUE(event_id, target_slot_id)
);

-- 13. 시스템 감사 로그 테이블
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. 행사 만족도 조사 결과 테이블
CREATE TABLE public.satisfaction_surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    rating_overall INT CHECK (rating_overall BETWEEN 1 AND 5),
    rating_matching INT CHECK (rating_matching BETWEEN 1 AND 5),
    rating_operation INT CHECK (rating_operation BETWEEN 1 AND 5),
    rating_reparticipation INT CHECK (rating_reparticipation BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_event_survey_response UNIQUE(event_id, user_id)
);

-- 15. 알림 발송 추적 테이블
CREATE TABLE public.notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    notification_type VARCHAR(100) NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_notif_status CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    CONSTRAINT chk_notif_retry_count CHECK (retry_count BETWEEN 0 AND 3)
);

-- -----------------------------------------------------------------------------
-- 보조 인덱스 (db_schema.md 4장 정합성 규칙 — 겹침/충돌 검사 및 조회 성능)
-- -----------------------------------------------------------------------------
-- 스케줄 겹침 검사: 전문가/스타트업별 시간 범위 조회 가속
CREATE INDEX idx_slots_expert_time ON public.matching_slots (event_id, expert_id, start_time, end_time);
CREATE INDEX idx_slots_startup_time ON public.matching_slots (startup_id, start_time, end_time)
    WHERE startup_id IS NOT NULL;
-- 테이블 충돌 검사
CREATE INDEX idx_slots_table_time ON public.matching_slots (event_id, table_id, start_time, end_time)
    WHERE table_id IS NOT NULL;
-- 미예약(빈) 슬롯 추출 (AI 자동배치)
CREATE INDEX idx_slots_empty ON public.matching_slots (event_id) WHERE startup_id IS NULL;

CREATE INDEX idx_participants_event ON public.event_participants (event_id, participant_type);
CREATE INDEX idx_participants_user ON public.event_participants (user_id);
CREATE INDEX idx_booking_history_slot ON public.booking_history (matching_slot_id, created_at DESC);
CREATE INDEX idx_attendance_slot_user ON public.attendance_logs (matching_slot_id, user_id, checked_in_at DESC);
CREATE INDEX idx_proposals_event ON public.matching_proposals (event_id);
CREATE INDEX idx_audit_target ON public.audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX idx_notif_retry ON public.notification_logs (status, next_retry_at)
    WHERE status = 'PENDING';
CREATE INDEX idx_users_auth ON public.users (auth_user_id) WHERE auth_user_id IS NOT NULL;
