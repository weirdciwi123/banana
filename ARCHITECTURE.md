# 아키텍처

## 1. 문서 목적

성찰 플래너의 기술 아키텍처를 정의한다. 본 문서는 해커톤 필수요건(웹앱, Microsoft Agent Framework, Copilot SDK, Azure 배포)을 만족하는 최소 구조를 기준으로 한다.

## 2. 아키텍처 원칙

1. 웹앱 우선: 사용자 경험은 브라우저 기반으로 제공
2. 에이전트 중심: 비즈니스 로직은 Microsoft Agent Framework에 집중
3. SDK 일관성: Copilot SDK를 통해 AI 상호작용 계층 표준화
4. Azure 운영: 배포/관측/확장은 Azure 기준
5. 안전한 확장: MVP는 단순화하고 이후 고도화

## 3. 시스템 구성요소

### 3.1 클라이언트
- 웹 프론트엔드
- 기능: 목표 입력, 일기 작성, 피드백 확인, 수용/거절 선택

### 3.2 애플리케이션 서버
- API 계층
- 세션/사용자 상태 라우팅
- 저장소 입출력

### 3.3 AI 오케스트레이션
- Microsoft Agent Framework 런타임
- 역할:
  - 계획 생성 워크플로우
  - 피드백 생성 워크플로우
  - 리플래닝 워크플로우

### 3.4 AI 연동 계층
- Copilot SDK
- 역할:
  - 모델 호출 인터페이스 표준화
  - 요청/응답 포맷 통일

### 3.5 모델 계층
- Azure 모델 엔드포인트(예: Azure OpenAI 또는 Foundry 모델)
- 역할: 텍스트 생성/평가 추론

### 3.6 데이터 계층
- 목표, 계획, 일기, 피드백, 조정 이력 저장
- 게스트 모드
  - MVP는 익명 세션 저장
  - 익명 세션은 서버가 발급한 세션 쿠키로 식별
  - 클라이언트가 전달한 세션 ID만으로 데이터 소유권을 인정하지 않음
  - 상태 변경 요청은 SameSite 쿠키와 Origin 검증 또는 CSRF 토큰으로 보호
  - 게스트 세션·AI 호출에는 요청 빈도와 입력 크기 제한 적용

## 4. 핵심 데이터 모델

### 4.1 Goal
- goalId
- guestSessionId
- goalText
- currentState
- duration
- constraints
- metric
- optionalAttributes
- createdAt
- updatedAt

### 4.2 PlanDay
- planDayId
- planId
- goalId
- guestSessionId
- dayIndex
- tasks
- status
- createdAt
- updatedAt

### 4.3 DiaryEntry
- diaryId
- goalId
- guestSessionId
- date
- content
- createdAt
- updatedAt

### 4.4 Feedback
- feedbackId
- diaryId
- guestSessionId
- executionEstimate
- summary
- nextActions
- policyPassed
- createdAt

### 4.5 ReplanDecision
- decisionId
- planId
- guestSessionId
- type(accept/reject)
- proposedChanges
- changedFields
- createdAt

## 5. 주요 시퀀스

### 5.1 계획 생성
1. 클라이언트가 목표/맥락 입력 전송
2. 서버가 Microsoft Agent Framework 워크플로우 호출
3. Microsoft Agent Framework가 Copilot SDK를 통해 모델 요청
4. 모델 응답을 계획 스키마로 정규화
5. 저장 후 클라이언트에 반환

### 5.2 일기 평가
1. 클라이언트가 일기 제출
2. 서버가 평가 워크플로우 호출
3. Microsoft Agent Framework가 Copilot SDK로 모델 추론
4. 중립형 피드백 규칙 검증 후 저장
5. 피드백/다음 액션 반환

### 5.3 승인형 리플래닝
1. 사용자가 수용/거절 선택
2. 서버가 분기 규칙 적용
3. 수용이면 리플래닝 워크플로우 실행
4. 거절이면 기존 계획 유지
5. 이력 저장 및 결과 반환

모든 조회·변경 요청은 요청 쿠키의 게스트 세션 소유권을 검증한 뒤 처리한다.

## 6. 정책 엔진

### 6.1 평가 정책
- 중립형 문체
- 금지 문구 필터
- 출력 길이/개수 제한

### 6.2 리플래닝 정책
- accept: 변경 허용 축만 조정
- reject: 계획 유지
- 변경 이력 저장

### 6.3 안전 정책
- 의료/정신건강 진단형 응답 차단
- 전문가 대체형 조언 차단

## 7. 배포 아키텍처(Azure)

### 7.1 권장 최소 구성
- 웹앱 호스팅
- API/에이전트 호스팅
- 컨테이너 이미지 저장소(ACR)
- 데이터 저장소
- 모델 엔드포인트 연결
- 모니터링/로그

### 7.2 환경 분리
- dev: 내부 테스트
- demo/prod: 해커톤 시연

### 7.3 배포 요건
- HTTPS 엔드포인트
- 가용 URL
- 장애 시 재배포 절차
- 실제 배포 전에는 배포 완료로 표시하지 않음

### 7.4 Docker 기반 배포 원칙
1. 프론트엔드/백엔드는 Docker 이미지로 패키징한다.
2. 이미지 태그 전략(예: 버전/커밋 SHA)을 사용해 배포 이력을 추적한다.
3. ACR에서 Azure 런타임(Container Apps 또는 App Service for Containers)으로 배포한다.
4. 런타임 설정은 이미지에 하드코딩하지 않고 환경 변수/시크릿으로 주입한다.

## 8. 보안/프라이버시 설계

1. 최소 수집 원칙
2. 게스트 모드 데이터 유실 고지
3. 전체 삭제 기능
4. 저장 위치 명시
5. 게스트 세션 소유권 검증
6. CSRF 및 요청 남용 방지
7. 접근 제어 및 키 관리

## 9. 관측성

- 요청 성공률
- 모델 응답 지연
- 워크플로우 단계별 실패율
- 피드백 생성 실패 로그
- 비용 추적 지표
- 익명 세션별 AI 호출량과 제한 초과율

## 10. 성능/확장

1. 프롬프트/출력 최소화
2. 비동기 처리 가능 구간 분리
3. 캐시 가능한 정적 데이터 분리
4. 모델 호출 실패 재시도 정책

## 11. 실패 처리 시나리오

1. 모델 응답 실패
- 사용자에게 재시도 안내
- 기존 데이터 보존

2. 저장 실패
- 임시 상태 보존 후 재요청

3. 리플래닝 실패
- 기존 계획 유지, 오류 표시

4. 게스트 세션 삭제
- 연결된 목표·계획·일기·피드백·결정 이력을 함께 삭제
- 세션 쿠키 만료 처리

## 12. 향후 확장

1. 오프라인 모드 및 데이터 내보내기
2. 도메인별 템플릿 계획 생성
3. KPI 분석 대시보드
4. 평가 품질 개선 루프

## 13. 해커톤 체크리스트

1. 웹앱 형태 제공
2. Microsoft Agent Framework 사용 증빙
3. Copilot SDK 사용 증빙
4. Azure 배포 URL 제출
5. 엔드투엔드 시연 가능 여부 확인

## 14. 개발 언어 스택(권장)

권장 개발언어 스택은 TypeScript 단일 언어 기반으로 정의하며, 구현 시작 전에 대안 채택 여부를 확정한다.

### 14.1 1순위 권장 스택
- 공통 언어: TypeScript
- 프론트엔드: Next.js(React) + TypeScript
- API/서버: Node.js(NestJS 또는 Fastify) + TypeScript
- 에이전트 오케스트레이션: Microsoft Agent Framework(TypeScript SDK)
- AI 연동: Copilot SDK(TypeScript)
- 데이터: Azure Cosmos DB 또는 Azure Database for PostgreSQL
- 배포: Azure Container Apps 또는 Azure App Service for Containers

### 14.2 대안 스택
- 백엔드/에이전트: Python(FastAPI) + Microsoft Agent Framework Python SDK
- AI 연동: Copilot SDK(Python)
- 프론트엔드: Next.js(TypeScript) 유지

### 14.3 권장 이유
1. 단일 언어(TypeScript) 기반으로 프론트/백엔드/에이전트 개발 생산성을 높일 수 있다.
2. 해커톤 기간 내 MVP 구현과 디버깅 속도를 높이기 쉽다.
3. Azure 배포 및 운영 자동화 파이프라인 구성이 단순해진다.

## 15. 심사 기준 반영

전체 배점은 100%다.

| 심사 기준 | 비중 | 아키텍처 반영 |
|---|---:|---|
| Copilot SDK·Microsoft Agent Framework 활용 | 25% | AI 오케스트레이션과 SDK 연동 계층으로 분리해 사용 증빙 가능 |
| 생산성 향상 및 문제 적합성 | 18% | 목표·계획·일기·피드백·리플래닝 폐루프 |
| Azure 클라우드 연동 | 18% | ACR, Azure 런타임, 모델 엔드포인트, 관측성 구성 |
| 기능 완성도 및 기술 구현 | 16% | API 서버와 세 가지 핵심 워크플로우 구성 |
| 사용자 경험 및 워크플로 설계 | 12% | 웹 클라이언트와 계정 없는 익명 세션 |
| 책임 있는 AI·보안·신뢰성 | 6% | 정책 엔진, 세션 소유권 검증, CSRF·남용 방지 |
| 혁신성 및 독창성 | 5% | 승인형 계획 조정 구조 |

### 심사 데모 증빙 흐름

1. 웹 클라이언트가 목표와 일기를 API로 전송한다.
2. API가 Microsoft Agent Framework 워크플로우를 호출한다.
3. 워크플로우가 Copilot SDK를 통해 AI 결과를 생성한다.
4. 정책 검증 후 결과를 저장하고 사용자에게 반환한다.
5. 사용자의 수용 선택이 리플래닝 결과와 결정 이력으로 연결된다.
6. Docker 컨테이너가 Azure 런타임에서 실행되고 로그로 상태를 확인한다.
