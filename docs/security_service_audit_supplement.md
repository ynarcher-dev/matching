# 서비스 보안 감사 추가 보완 메모 (Supplement Report)

본 문서는 기존 [서비스 전체 보안 감사 메모](./security_service_audit.md)를 바탕으로, 리포지토리의 소스 코드와 Supabase 마이그레이션 이력을 분석하여 추가로 도출해낸 보안 취약점 및 운영 리스크와 그에 대한 개선 대책을 정리한 보완 보고서입니다.

---

## 1. 추가 식별된 보안 취약점 및 개선 대책

### [보완-01] Supabase Storage RLS 경로 파싱 우회를 통한 타인 파일 조작/탈취 위험 (Path Traversal / Owner Manipulation)

* **현황 및 취약 내용**:
  * `proposals` 및 `avatars` 버킷의 객체 소유권 검증을 위해 `public._storage_owner_id(name)` 헬퍼 함수를 사용하고 있습니다. 
  * `0067_fix_storage_owner_id.sql`에 정의된 `_storage_owner_id` 함수는 경로 문자열을 `/` 단위로 쪼갠 후, 단순 배열의 크기에 따라 `v_parts[1]` 또는 `v_parts[2]`를 반환하도록 설계되어 있습니다.
  ```sql
  IF array_length(v_parts, 1) = 1 THEN
      RETURN v_parts[1]::uuid;
  ELSIF array_length(v_parts, 1) >= 2 THEN
      RETURN v_parts[2]::uuid;
  END IF;
  ```
  * 만약 공격자가 API를 직접 호출하여 경로를 `{victim_uuid}/{attacker_uuid}/malicious.pdf`와 같이 설정하여 업로드나 조회를 시도하면, `_storage_owner_id`는 `v_parts[2]`인 공격자 본인의 UUID(`attacker_uuid`)를 반환합니다.
  * 결과적으로 RLS 정책의 `_storage_owner_id(name) = current_app_user_id()` 가드를 무력화하고 타인의 폴더(구조) 하위에 침범하여 파일을 업로드, 삭제 또는 수정할 수 있게 됩니다.
* **위험도**: **High**
* **개선 대책**:
  * 경로 구조가 정의된 포맷(`{owner_id}/{filename}`)에 엄격히 일치하는지 정규식 검증을 동반해야 합니다.
  * `proposals` 버킷의 경우, `starts_with(name, current_app_user_id()::text || '/')` 형식을 RLS `WITH CHECK`에 직접 포함하거나, 헬퍼 함수 내부에서 UUID 위치가 임의의 뎁스(Depth)로 우회되지 않도록 엄격한 정규 표현식으로 문자열 형식을 체크하도록 수정해야 합니다.

---

### [보완-02] Supabase Storage RLS에 파일 크기(Size) 제한 정책 누락에 따른 리소스 고갈 취약점 (DoS & Financial Cost Abuse)

* **현황 및 취약 내용**:
  * `0007_storage.sql`, `0036_company_photos.sql` 등 스토리지 객체 쓰기 RLS 정책(`proposals_write`, `avatars_write`, `event_photos_write`)에서 업로드되는 파일의 용량 제한 검증이 누락되어 있습니다.
  * 프론트엔드 코드(`src/lib/storage.ts` 등)에서 파일 용량을 검증하지만, 프록시 도구를 사용하여 클라이언트 가드를 우회하면 기가바이트(GB) 단위의 임의의 대형 파일을 제한 없이 업로드할 수 있습니다.
  * 이는 디스크 용량 고갈로 인한 서비스 마비(DoS)뿐만 아니라, 클라우드 스토리지 보관 및 아웃바운드 트래픽 요금의 급격한 폭증을 유발할 수 있습니다.
* **위험도**: **Medium-High**
* **개선 대책**:
  * 스토리지 RLS 정책의 `WITH CHECK` 문에 업로드되는 객체의 크기 메타데이터 검증 조건을 결합해야 합니다.
  * 예시 (프로필 사진은 5MB, 제안서는 20MB 제한):
    ```sql
    -- avatars 버킷의 경우 예시
    bucket_id = 'avatars' AND (
        (metadata->>'size')::int < 5242880
    )
    ```

---

### [보완-03] 관리자 및 스태프 세션에 대한 세션 버전(`session_version`) 검증 누락 (Session Invalidation Bypass)

* **현황 및 취약 내용**:
  * `0002_auth_helpers.sql`에서 정의된 호출자 식별 함수 `current_app_user_id()`는 참가자(스타트업/전문가)의 커스텀 JWT 검증 시 `session_version`을 대조해 강제 세션 무효화를 처리합니다.
  * 그러나 `Supabase Auth`를 사용하는 관리자(`ADMIN`) 및 스태프(`STAFF`) 분기(`ELSE` 구문)에서는 `session_version`에 대한 검증을 전혀 수행하지 않고, 오직 `deleted_at IS NULL`과 `auth.uid()`의 매핑 정보만을 조회합니다.
  ```sql
  ELSE (
      -- Supabase Auth (ADMIN/STAFF)
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
  )
  ```
  * 이로 인해 관리자나 스태프 계정의 JWT 토큰이 탈취되거나 분실된 상황에서, DB 측에서 `session_version`을 증가시키는 `admin_invalidate_user_sessions` 등을 실행해도, 해당 관리자/스태프의 기존 발급 세션(JWT)은 만료 시까지 RLS 정책을 우회하며 모든 시스템 제어권을 행사할 수 있습니다.
* **위험도**: **Medium**
* **개선 대책**:
  * 관리자 및 스태프 역시 Supabase Auth의 Custom Claim에 `session_version`을 기록하여 동기화하거나, `current_app_user_id()` 함수의 `ELSE` 블록에서도 `session_version`이 일치하는지 함께 검사하도록 보완해 세션 즉시 만료 조치가 전 역할에 걸쳐 작동하도록 통일해야 합니다.

---

### [보완-04] 스태프(`STAFF`) 역할의 행사 범위 권한 통제 누락 (Missing Event-Scope RLS in DB inserts)

* **현황 및 취약 내용**:
  * 스태프가 현장 사진을 테이블에 등록하는 `company_photos` 테이블의 `INSERT` RLS 정책(`company_photos_insert`)을 보면, 전역 역할에 대해 `public.is_admin_or_staff()` 조건만을 체크하고 있습니다.
  ```sql
  CREATE POLICY company_photos_insert ON public.company_photos FOR INSERT TO authenticated
  WITH CHECK (
      public.is_admin_or_staff()
      AND uploaded_by = public.current_app_user_id()
      AND EXISTS ( ... )
  );
  ```
  * 이로 인해 스태프가 특정 행사에 배정되지 않았더라도(즉, `can_staff_event(event_id)`가 `FALSE`인 타 행사여도), 본인의 전역 역할이 `STAFF`이기만 하면 해당 행사의 참가 스타트업을 대상으로 현장 사진 테이블 데이터를 자유롭게 밀어 넣을 수 있는 상태가 방치됩니다.
  * (Storage RLS의 경우 `0045`에서 `can_staff_event` 검증이 보완되었지만, DB 테이블의 Write RLS 정책에는 해당 검증이 결여되어 불일치가 발생합니다.)
* **위험도**: **Medium**
* **개선 대책**:
  * `company_photos_insert` RLS 정책에 `public.can_staff_event(company_photos.event_id)` 검증 조건을 추가하여, 자신이 배정된 행사의 데이터만 추가할 수 있도록 쓰기 인가를 좁혀야 합니다.

---

### [보완-05] 비동기 알림 시스템(Solapi/이메일)의 상태 전이 루프에 따른 무차별 발송 및 요금 테러 위험 (Trigger-based SMS/Email DoS)

* **현황 및 취약 내용**:
  * 행사 상태가 `BOOKING`으로 업데이트되면 `trg_notify_event_status` 트리거가 실행되어 행사의 모든 참가 스타트업 전원에게 알림 큐를 적재(`_enqueue_notification`)합니다.
  * 만약 침입자 또는 내부 관리자의 악의적인 조작이나 API 스크립트 오작동으로 인해 행사의 상태가 `DRAFT` ↔ `BOOKING` 단계를 연속적으로 번갈아 가며 전이될 경우, 수천 수만 건의 비동기 알림톡이 중복으로 생성되어 대량 발송될 수 있습니다.
  * 발송 수수료가 수반되는 Solapi 연동 시 재정적 피해(Financial Abuse)가 기하급수적으로 커질 수 있는 지점입니다.
* **위험도**: **Medium**
* **개선 대책**:
  * `_enqueue_notification` 함수 단에서 하루 또는 행사 기간 내에 한 수신자에게 전송 가능한 알림 카운트 임계값(Quota Limit)을 두거나, 동일한 행사 알림 타입(`EVENT_BOOKING_OPEN` 등)이 이미 한 번이라도 발송 이력이 존재하는 경우 적재 단에서 예외 처리되도록 트리거 조건에 안전 가드를 설정해야 합니다.

---

### [보완-06] 현장 사진 업로드 시 EXIF 메타데이터 미제거로 인한 민감 개인정보(GPS) 유출 위험

* **현황 및 취약 내용**:
  * 현장 스태프가 모바일 기기 카메라를 통해 참가 기업의 부스 및 진행 사진을 찍어 `event-photos` 버킷에 업로드하고 있습니다.
  * 업로드된 이미지 원본이 보존됨에 따라 이미지 내에 포함된 촬영 기종 정보, 정확한 GPS 촬영 좌표(위도, 경도) 등의 EXIF 메타데이터가 그대로 노출되어 업로드됩니다.
  * 향후 일반 참가자가 본인 기업의 사진을 내려받거나, 혹은 스토리지 링크가 공유되었을 때 상세 위치 및 일시 정보가 담긴 EXIF를 추출할 수 있으므로 보안 및 프라이버시 침해 소지가 있습니다.
* **위험도**: **Low-Medium**
* **개선 대책**:
  * 클라이언트 단에서 업로드 전 이미지 압축/리사이징 시점(`canvas` 렌더링 등을 거쳐 새 파일로 뽑는 과정)에서 EXIF 메타데이터를 소멸(strip)시키는 프로세스를 적용하거나, 백엔드/엣지 이미지 처리 과정에서 메타데이터 소멸 과정을 의무화해야 합니다.

---

### [보완-07] 긴급 로그인 토큰 API(`emergency-login` Edge Function)의 무차별 대입 및 DB 커넥션 부하 위험 (DoS)

* **현황 및 취약 내용**:
  * `emergency-login` 엣지 펑션 및 `consume_emergency_login_token` RPC는 평문 토큰을 수신하여 1회용 로그인 세션을 발행해 줍니다.
  * 토큰 자체가 CSPRNG 기반의 256bit 난수(64글자 16진수)이므로 brute-force 자체로 로그인이 성공할 가능성은 0에 수렴하지만, 이 엔드포인트 자체에 **아무런 Rate Limiting 장치가 부재**하여 무차별적으로 무한 호출을 할 수 있습니다.
  * 토큰 검증 로직 내에서 `digest()` 해시 연산 및 DB 락(`FOR UPDATE`) 조회가 수행되므로, 대량의 가짜 토큰을 밀어 넣는 DoS(Denial of Service) 공격 발생 시 데이터베이스 성능 저하 및 커넥션 고갈을 쉽게 유발할 수 있습니다.
* **위험도**: **Low-Medium**
* **개선 대책**:
  * `emergency-login` Edge Function 내에도 IP 해시 또는 요청 클라이언트 단위를 기반으로 한 Rate Limiter(예: 10분 내 동일 IP 최대 20회 요청 제한 등)를 구성해야 합니다.

---

## 2. 보안 감사 우선순위 추가 목록 권고

기존 감사 문서의 우선순위에 더불어, 다음 3가지 조치 사항을 **P1** 등급에 추가할 것을 적극 권장합니다.

1. **[P1] Storage RLS 경로 검증 수정**: `_storage_owner_id` 우회를 막기 위해 `starts_with` 또는 정규식을 RLS 조건에 직접 결합하여 경로 변조 시도를 차단합니다.
2. **[P2] Storage 업로드 용량 제한 강제**: RLS `WITH CHECK` 내에 `size` 메타데이터 체크 조건을 추가하여 비정상적으로 거대한 파일 업로드를 차단합니다.
3. **[P2] 관리자/스태프 세션 강제 만료 로직 보완**: `current_app_user_id()`에서 `ADMIN`/`STAFF` 분기 시에도 `session_version`을 대조하도록 쿼리를 수정하여 토큰 탈취에 긴급 대응할 수 있는 인프라를 보장합니다.
