# TRD

## 1. 문서 목적
이 문서는 성찰 플래너의 기술 요구사항(Technical Requirements)을 정의한다.
기획 문서(PRD, IDEATION)와 아키텍처 문서를 구현 가능한 기술 항목으로 정리하여 개발/테스트/배포 기준으로 사용한다.

기준 문서:
- PRD.md
- IDEATION.md
- ARCHITECTURE.md

## 2. 범위
### 2.1 포함 범위 (MVP)
- 웹앱 기반 사용자 인터페이스
- 목표 입력 및 계획 생성
- 일기 작성/조회
- 중립형 피드백 생성
- 승인형 리플래닝(accept/reject)
- 계정 없는 익명 세션 모드
- 익명 서버 세션 기반 저장
- Azure 배포 가능한 구조

### 2.2 제외 범위 (MVP 외)
- 소셜 랭킹
- 강제 스케줄링
- 처벌형 코칭
- 의료/정신건강 진단형 피드백
- 사용자 계정, 로그인, 회원가입 기능

## 3. 기술 목표
1. 해커톤 필수 기술요건 준수
- 웹앱
- Microsoft Agent Framework
- Copilot SDK
- Azure 배포

2. 빠른 구현과 검증
- 핵심 루프(입력→계획→실행→성찰→재계획) 우선
- 정책 기반 안전성 및 일관성 확보

3. 확장 가능한 구조
- 에이전트 워크플로우와 API 계층 분리
- 데이터 모델 고정 후 기능 확장

## 4. 권장 기술 스택
### 4.1 1순위 권장
- 공통 언어: TypeScript
- 프론트엔드: Next.js(React) + TypeScript
- 백엔드/API: Node.js(Fastify 또는 NestJS) + TypeScript
- 에이전트 오케스트레이션: Microsoft Agent Framework(TypeScript SDK)
- AI 연동: Copilot SDK(TypeScript)
- 데이터: Azure Cosmos DB 또는 Azure Database for PostgreSQL
- 배포: Azure Container Apps 또는 Azure App Service for Containers

### 4.2 대안
- 백엔드/에이전트: Python(FastAPI) + Microsoft Agent Framework Python SDK
- AI 연동: Copilot SDK(Python)
- 프론트엔드: Next.js(TypeScript)

## 5. 시스템 구성 요구사항
### 5.1 클라이언트
필수 기능:
- 목표/맥락 입력 폼
- 일기 작성 및 조회
- 피드백 확인
- 수용/거절 UI

요구사항:
- 모바일/데스크톱 반응형
- 입력 유효성 검사
- 실패 시 재시도 가능한 UX

### 5.2 API 서버
필수 책임:
- 요청 검증
- 세션/게스트 상태 관리
- Microsoft Agent Framework 워크플로우 호출
- 데이터 저장/조회

요구사항:
- REST API 또는 RPC 스타일 일관 유지
- 워크플로우별 에러 코드 표준화
- 감사 가능한 요청/응답 로깅(개인정보 마스킹)
- 게스트 세션은 서버가 발급한 HttpOnly·Secure 쿠키로 식별
- 세션 소유권을 서버에서 검증하고, 클라이언트 제공 ID만으로 접근을 허용하지 않음
- 상태 변경 요청은 SameSite 쿠키 정책과 Origin 검증 또는 CSRF 토큰으로 CSRF를 방어
- 게스트 세션 생성·AI 호출·데이터 삭제 API에 요청 빈도와 크기 제한을 적용

### 5.3 AI 오케스트레이션
필수 워크플로우:
- 계획 생성 워크플로우
- 피드백 생성 워크플로우
- 리플래닝 워크플로우

요구사항:
- 워크플로우별 입력/출력 스키마 고정
- 실패 재시도 정책(최대 재시도 횟수/백오프 정의)
- 정책 엔진 검증 단계 선행

### 5.4 AI 연동 계층
요구사항:
- Copilot SDK를 통한 모델 호출 표준화
- 모델별 설정(temperature, max tokens 등) 환경 분리
- 타임아웃 및 예외 처리 표준화

### 5.5 데이터 계층
필수 저장 대상:
- Goal
- PlanDay
- DiaryEntry
- Feedback
- ReplanDecision

요구사항:
- 목표 단위로 조회 가능
- 날짜 기준 일기 조회 가능
- 리플래닝 이력 추적 가능
- 게스트 데이터 삭제 API 제공

## 6. 데이터 모델 기술 요구사항
### 6.1 Goal
- goalId: string (PK)
- guestSessionId: string (indexed, required for guest mode)
- goalText: string
- currentState: string
- duration: enum(7d, 14d, 30d)
- constraints: string[]
- metric: string
- optionalAttributes: object
- createdAt/updatedAt: datetime

### 6.2 PlanDay
- planDayId: string (PK)
- planId: string (FK)
- goalId: string (FK)
- guestSessionId: string (indexed, required for guest mode)
- dayIndex: number
- tasks: string[]
- status: enum(planned, done, skipped)
- createdAt/updatedAt: datetime

### 6.3 DiaryEntry
- diaryId: string (PK)
- goalId: string (FK)
- guestSessionId: string (indexed, required for guest mode)
- date: date
- content: string
- createdAt/updatedAt: datetime

### 6.4 Feedback
- feedbackId: string (PK)
- diaryId: string (FK)
- guestSessionId: string (indexed, required for guest mode)
- executionEstimate: number (0~100)
- summary: string
- nextActions: string[]
- policyPassed: boolean
- createdAt: datetime

### 6.5 ReplanDecision
- decisionId: string (PK)
- planId: string (FK)
- guestSessionId: string (indexed, required for guest mode)
- type: enum(accept, reject)
- proposedChanges: object
- changedFields: object
- createdAt: datetime

## 7. 핵심 워크플로우 요구사항
### 7.1 계획 생성
입력:
- 목표 설명, 현재 상태, 기간, 제약, 측정지표

처리:
1. 입력 스키마 검증
2. Microsoft Agent Framework 계획 생성 워크플로우 실행
3. Copilot SDK 모델 호출
4. 계획 스키마 정규화
5. 저장 및 반환

출력:
- 일차 단위 계획 목록(실행 가능한 문장)

### 7.2 피드백 생성
입력:
- 목표 ID, 일기 내용, 날짜

처리:
1. 피드백 워크플로우 실행
2. 모델 추론
3. 정책 엔진(중립 톤/금지 문구) 검증
4. 저장 및 반환

출력:
- 실행률 추정
- 사실 요약
- 다음 액션 1~2개

### 7.3 승인형 리플래닝
입력:
- planId, decisionType(accept/reject)

처리:
- accept: 허용 변경 축만 조정하여 리플래닝 실행
- reject: 기존 계획 유지
- 두 경우 모두 이력 저장

출력:
- 최종 계획 상태
- 변경 이력

## 8. 정책 엔진 요구사항
### 8.1 평가 정책
- 중립형 문체 유지
- 비난/낙인/처벌형 문구 차단
- 출력 길이 제한

### 8.2 안전 정책
- 의료/정신건강 진단형 응답 차단
- 전문가 대체형 조언 차단

### 8.3 리플래닝 정책
- 자동 반영 금지
- 사용자 승인(accept) 시에만 반영
- 변경 이력 필수 저장

## 9. API 요구사항 (초안)

모든 보호 대상 엔드포인트는 서버가 발급한 게스트 세션 쿠키를 검증한다. 다른 세션의 리소스 ID가 전달되면 `404`를 반환해 리소스 존재 여부가 불필요하게 노출되지 않도록 한다.

공통 오류 응답은 `code`, `message`, `requestId` 필드를 사용한다. 모델·저장소 오류의 내부 상세와 비밀값은 클라이언트에 반환하지 않는다.

### 9.1 목표 및 계획
- POST /goals
- POST /goals/{goalId}/plans:generate
- GET /goals/{goalId}/plans

### 9.2 일기/피드백
- POST /goals/{goalId}/diaries
- GET /goals/{goalId}/diaries
- POST /diaries/{diaryId}/feedback:generate
- GET /diaries/{diaryId}/feedback

### 9.3 리플래닝
- POST /plans/{planId}/decisions
- GET /plans/{planId}/decisions

### 9.4 게스트/데이터 제어
- POST /guest/session
- DELETE /guest/session
- 세션 ID는 요청 쿠키에서 확인하며 URL에 포함하지 않는다.
- 삭제 성공 후 세션 쿠키를 만료시킨다.
- 세션 쿠키는 운영 환경에서 `HttpOnly`, `Secure`, `SameSite=Lax` 이상으로 설정한다.

### 9.5 AI 상담
- POST /consultation/messages
- GET /consultation/messages
- 상담 메시지와 응답은 익명 세션에만 연결한다.
- 상담 응답은 중립형 정책과 의료·정신건강 진단 금지 정책을 통과한 경우에만 반환한다.

## 10. 비기능 요구사항
### 10.1 성능
- 일반 요청 체감 응답 5초 이내 목표
- 모델 호출 타임아웃 및 사용자 재시도 UX 제공

### 10.2 안정성
- 부분 실패 시 데이터 유실 방지
- 재시도/백오프 정책 적용

### 10.3 보안/프라이버시
- 최소 수집 원칙
- 저장 위치 및 유실 가능성 안내
- 전체 삭제 기능 제공
- 비밀값은 환경 변수/키 관리 서비스 사용
- CSRF 방어, 요청 빈도 제한, 입력 크기 제한 적용

### 10.4 관측성
- 요청 성공률
- 모델 응답 지연
- 워크플로우 단계별 실패율
- 비용/토큰 사용량 지표

### 10.5 데이터 수명주기
- 게스트 세션과 연결된 데이터는 마지막 활동 이후 정의된 보관 기간이 지나면 자동 삭제한다.
- 보관 기간과 자동 삭제 정책은 사용자 고지 문구와 운영 설정에 동일하게 반영한다.

## 11. 테스트 요구사항
### 11.1 단위 테스트
- 입력 스키마 검증
- 정책 엔진 규칙 검증
- 리플래닝 분기 검증

### 11.2 통합 테스트
- API ↔ Microsoft Agent Framework ↔ Copilot SDK 연동
- 저장소 입출력
- 오류 전파 및 예외 처리

### 11.3 E2E 테스트
- 목표 입력 → 계획 생성 → 일기 → 피드백 → 수용/거절
- 게스트 생성/조회/삭제
- 익명 세션 생성 → 상담 메시지 전송 → 상담 응답 조회

## 12. 환경 및 배포 요구사항
### 12.1 환경
- dev: 내부 테스트
- demo/prod: 해커톤 시연

### 12.1.1 컨테이너화 요구사항
- 애플리케이션 컴포넌트는 Docker 이미지로 빌드 가능해야 한다.
- Dockerfile은 재현 가능한 빌드(고정 베이스 이미지 태그) 기준으로 관리한다.
- 실행 환경 설정은 이미지 외부(환경 변수/시크릿)에서 주입한다.
- 컨테이너는 런타임이 제공하는 `PORT` 환경 변수로 수신 포트를 설정하고 헬스체크 엔드포인트를 제공한다.

### 12.2 배포 요구사항
- Azure HTTPS 엔드포인트
- 가용 URL 제공
- 실패 시 재배포 절차 문서화

### 12.3 Azure 배포 구성(최소)
- Azure Container Registry(ACR)
- 웹앱 호스팅
- API/에이전트 호스팅
- 데이터 저장소
- 모델 엔드포인트 연결
- 모니터링/로그

### 12.4 Docker + Azure 배포 절차(표준)
1. 프론트엔드/백엔드 Docker 이미지 빌드
2. ACR 로그인 및 이미지 푸시
3. Azure Container Apps 또는 App Service for Containers에 배포
4. 시크릿/환경 변수 주입(AI 키, DB 연결 정보)
5. 헬스체크, 로그, 롤백 경로 확인

## 13. 오픈 이슈
1. 데이터 저장소 최종 선택(Cosmos DB vs PostgreSQL)
2. 모델 선택 및 비용 상한선
3. 배포 타깃(Azure App Service for Containers vs Azure Container Apps)

오픈 이슈가 확정되기 전까지는 선택지를 동시에 구현하지 않으며, 결정 사항은 본 문서와 ARCHITECTURE.md에 함께 반영한다.

## 14. 완료 기준 (TRD 관점)
다음 조건이 충족되면 TRD 기반 MVP 구현 준비 완료로 본다.
- 핵심 워크플로우 3종의 입력/출력 스키마 확정
- 정책 엔진 규칙 문서화 및 테스트 케이스 정의
- API 초안 확정 및 에러 규약 정의
- Azure 배포 최소 구성 확정
- E2E 시나리오 1회 완주 가능

## 15. 문서 교차검증 결과
본 문서는 PRD, IDEATION, ARCHITECTURE 문서를 기준으로 다회 교차검증했다.

정합성 확인 항목:
1. 범위 일치
- MVP 포함/제외 항목이 PRD와 동일하게 반영됨

2. 핵심 정책 일치
- 중립형 피드백, 승인형 리플래닝, 게스트 모드 원칙이 IDEATION/ARCHITECTURE와 일치함

3. 필수 기술요건 일치
- 웹앱, Microsoft Agent Framework, Copilot SDK, Azure 배포 요건이 모든 문서에서 동일함

4. 용어/표기 정합성 개선
- 문서 파일명과 표기를 프로젝트 표준(README, 아키텍처)으로 통일

5. 배포 전략 정합성 개선
- Docker + Azure 배포 원칙을 문서 전반에 공통 기준으로 반영

## 16. 심사 기준별 기술 검증 항목

전체 배점은 100%다.

| 심사 기준 | 비중 | 검증 항목 |
|---|---:|---|
| Copilot SDK·Microsoft Agent Framework 활용 | 25% | 계획·피드백·리플래닝·상담 호출과 사용 증빙 |
| 생산성 향상 및 문제 적합성 | 18% | 목표 입력이 실행 가능한 일차 계획으로 변환되는지 확인 |
| Azure 클라우드 연동 | 18% | Docker 빌드, ACR 푸시, HTTPS 런타임, 로그 확인 |
| 기능 완성도 및 기술 구현 | 16% | 핵심 API와 E2E 플로우 완주 여부 |
| 사용자 경험 및 워크플로 설계 | 12% | 계정 없는 시작, 입력 검증, 오류·재시도 UX |
| 책임 있는 AI·보안·신뢰성 | 6% | 정책 차단, 세션 격리, CSRF, 제한, 삭제·자동 만료 |
| 혁신성 및 독창성 | 5% | 성찰 피드백과 승인형 리플래닝의 차별성 |

### 심사 대응 구현 체크리스트

- [ ] 계획·피드백·상담·리플래닝의 AI 실행 경로와 SDK 사용 근거 확인
- [ ] 달성 확인 기준과 제약이 계획 결과에 반영되는지 확인
- [ ] 계정 없는 익명 세션 생성부터 데이터 삭제까지 E2E 확인
- [ ] 수용/거절에 따른 계획 변경과 결정 이력 확인
- [ ] Docker 빌드, ACR 푸시, Azure HTTPS URL, 로그 확인
- [ ] AI 정책 차단, 세션 격리, 요청 제한, 개인정보 마스킹 확인
- [ ] 각 심사 항목에 대응하는 데모 화면 또는 실행 로그 준비
