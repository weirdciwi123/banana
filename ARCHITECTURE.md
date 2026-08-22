# 아키텍처

## 1. 문서 목적

성찰 플래너의 기술 아키텍처를 정의한다. 본 문서는 해커톤 필수요건(웹앱, Microsoft Agent Framework, Copilot SDK, Azure 배포)을 만족하는 최소 구조를 기준으로 한다.

## 2. 아키텍처 원칙

1. 웹앱 우선: 사용자 경험은 브라우저 기반으로 제공
2. 에이전트 중심: 비즈니스 로직은 Agent Framework에 집중
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
  - 로컬 저장 또는 익명 세션 저장

## 4. 핵심 데이터 모델

### 4.1 Goal
- goalId
- goalText
- currentState
- duration
- constraints
- metric
- optionalAttributes

### 4.2 PlanDay
- planId
- goalId
- dayIndex
- tasks
- status

### 4.3 DiaryEntry
- diaryId
- goalId
- date
- content

### 4.4 Feedback
- feedbackId
- diaryId
- executionEstimate
- summary
- nextActions

### 4.5 ReplanDecision
- decisionId
- planId
- type(accept/reject)
- changedFields
- createdAt

## 5. 주요 시퀀스

### 5.1 계획 생성
1. 클라이언트가 목표/맥락 입력 전송
2. 서버가 Agent Framework 워크플로우 호출
3. Agent Framework가 Copilot SDK를 통해 모델 요청
4. 모델 응답을 계획 스키마로 정규화
5. 저장 후 클라이언트에 반환

### 5.2 일기 평가
1. 클라이언트가 일기 제출
2. 서버가 평가 워크플로우 호출
3. Agent Framework가 Copilot SDK로 모델 추론
4. 중립형 피드백 규칙 검증 후 저장
5. 피드백/다음 액션 반환

### 5.3 승인형 리플래닝
1. 사용자가 수용/거절 선택
2. 서버가 분기 규칙 적용
3. 수용이면 리플래닝 워크플로우 실행
4. 거절이면 기존 계획 유지
5. 이력 저장 및 결과 반환

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

## 8. 보안/프라이버시 설계

1. 최소 수집 원칙
2. 게스트 모드 데이터 유실 고지
3. 전체 삭제 기능
4. 저장 위치 명시
5. 접근 제어 및 키 관리

## 9. 관측성

- 요청 성공률
- 모델 응답 지연
- 워크플로우 단계별 실패율
- 피드백 생성 실패 로그
- 비용 추적 지표

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

## 12. 향후 확장

1. 계정 연동 및 멀티 디바이스 동기화
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

현재 문서에는 개발언어 스택이 명시되어 있지 않고, 필수 기술요건만 정의되어 있다.

### 14.1 1순위 권장 스택
- 공통 언어: TypeScript
- 프론트엔드: Next.js(React) + TypeScript
- API/서버: Node.js(NestJS 또는 Fastify) + TypeScript
- 에이전트 오케스트레이션: Microsoft Agent Framework(TypeScript SDK)
- AI 연동: Copilot SDK(TypeScript)
- 데이터: Azure Cosmos DB 또는 Azure Database for PostgreSQL
- 배포: Azure App Service 또는 Azure Container Apps

### 14.2 대안 스택
- 백엔드/에이전트: Python(FastAPI) + Microsoft Agent Framework Python SDK
- AI 연동: Copilot SDK(Python)
- 프론트엔드: Next.js(TypeScript) 유지

### 14.3 권장 이유
1. 단일 언어(TypeScript) 기반으로 프론트/백엔드/에이전트 개발 생산성을 높일 수 있다.
2. 해커톤 기간 내 MVP 구현과 디버깅 속도를 높이기 쉽다.
3. Azure 배포 및 운영 자동화 파이프라인 구성이 단순해진다.
