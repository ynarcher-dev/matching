# UI/UX Rework 09-A - Design Tokens

## 1. 목표

전면 개편의 첫 단계로 색상, 상태 tone, radius, shadow, spacing, typography 기준을 정리한다. 현재 직접 Tailwind 색상을 페이지마다 사용하는 구조를 줄이고, 기능성 UI가 같은 의미를 같은 시각 언어로 표현하도록 만든다.

## 2. 현재 문제

- `brand`, `surface`, `border`, `muted` 외 상태 색상 토큰이 부족하다.
- `emerald`, `blue`, `violet`, `orange`, `red`, `gray` 계열이 페이지별로 직접 사용된다.
- `Card`는 `rounded-2xl`, 테이블/필터/버튼은 `rounded-xl`, `rounded-lg`, `rounded-full`이 섞여 있다.
- danger와 brand가 모두 빨강 계열이라 주 액션과 위험 액션이 겹쳐 보일 수 있다.

## 3. 작업 범위

- `src/index.css` theme token 확장
- 상태 tone map 정리
- radius/spacing/shadow 기본값 결정
- 공통 badge/button/alert/table이 사용할 class map 정의

## 4. 권장 토큰

색상:

- `brand`: 주요 액션
- `brand-hover`: 주요 액션 hover
- `neutral`: 본문/강한 텍스트
- `surface`: 앱 배경
- `surface-raised`: 카드/패널
- `border`: 기본 경계
- `muted`: 비활성/보조 배경
- `success`: 완료, 출석, 예약 가능
- `warning`: 대기, 주의, 미완료
- `danger`: 삭제, 실패, 취소, 불참
- `info`: 안내, 진행 중
- `ai`: AI 배정, 자동 추천

radius:

- page panel: `rounded-xl`
- card/table container: `rounded-lg` 또는 `rounded-xl`
- input/select/button: `rounded-lg`
- compact action: `rounded-md`
- badge/chip: `rounded-full`

## 5. 폰트와 타이포그래피

전 영역의 기본 폰트는 Pretendard로 통일한다. 현재 `src/index.css`의 `--font-sans`가 `'Pretendard Variable', 'Pretendard', sans-serif`로 잡혀 있으므로 이 방향을 유지하고, 개편 시에도 별도 화면이나 컴포넌트에서 다른 폰트 패밀리를 지정하지 않는다.

폰트 크기는 국내 서비스형 UI에서 일반적으로 쓰이는 가독성 기준을 따른다. 운영툴 특성상 과한 hero-scale 타입보다 정보 밀도와 스캔 가능성을 우선한다.

들쑥날쑥한 폰트 크기 문제를 방지하고 전역적으로 일관성을 유지하기 위해 **Tailwind CSS v4 테마 변수**로 국내 규격 크기를 아래와 같이 매핑하여 덮어쓴다.

**[Tailwind v4 폰트 테마 규격 매핑]**
- `--text-xs`: `12px` (배지/칩/메타 정보, 테이블 헤더/보조 라벨)
- `--text-sm`: `14px` (일반 입력/셀렉트/버튼, 테이블 본문)
- `--text-base`: `15px` (본문 기본, 모바일 주요 액션)
- `--text-lg`: `16px` (카드/패널 내부 제목)
- `--text-xl`: `18px` (섹션 제목 2순위)
- `--text-2xl`: `20px` (섹션 제목 1순위)
- `--text-3xl`: `24px` (페이지 제목)

적용 원칙:

- viewport width에 따라 폰트 크기를 임의로 스케일하지 않는다.
- letter spacing은 기본값 0을 사용한다.
- 버튼/칩/배지 내부 텍스트가 줄바꿈 없이 깨지는 경우, 폰트 축소보다 레이아웃 재배치를 우선한다.
- 관리자 백오피스는 `13px~15px` 밀도 중심, 스타트업/전문가/현장 모바일 화면은 `15px~16px` 터치 중심을 우선한다.
- 한 화면 안에서 제목, 라벨, 본문, 메타, 액션의 크기 위계를 4~5단계 이내로 제한한다.

## 6. 완료 기준

- 상태 색상이 직접 색상명 대신 tone map을 통해 사용된다.
- `EventStatusBadge`, `EventPermissionBadge`, 알림 상태, 출석 상태, 슬롯 상태가 같은 tone 규칙을 공유한다.
- 기존 화면의 시각 의미가 바뀌지 않고 색상 규칙만 정리된다.
- 전 영역에서 Pretendard를 기본 폰트로 유지하고, 폰트 크기는 국내 서비스형 UI 기준에 맞춰 위계를 통일한다.
