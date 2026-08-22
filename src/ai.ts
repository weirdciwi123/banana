import { CopilotClient, approveAll } from "@github/copilot-sdk";
import { join } from "node:path";
import type { DiaryEntry, Goal, PlanDay } from "./domain.js";

export interface AiProvider {
  consult(message: string, history: string[]): Promise<string>;
  generatePlan(goal: Goal): Promise<string[]>;
  generateFeedback(goal: Goal, diary: DiaryEntry): Promise<{ executionEstimate: number; summary: string; nextActions: string[] }>;
  replan(goal: Goal, plans: PlanDay[], feedback: string): Promise<Record<string, unknown>>;
  revisePlan(goal: Goal, plans: PlanDay[], feedbackMessage: string, history: string[]): Promise<{ assistantMessage: string; tasks: string[] }>;
  revisePlanDay(goal: Goal, plan: PlanDay, feedbackMessage: string, history: string[]): Promise<{ assistantMessage: string; revisedTask: string }>;
  adjustNextDayPlan(goal: Goal, todayPlan: PlanDay, nextPlan: PlanDay, diary: DiaryEntry): Promise<{ assistantMessage: string; revisedTask: string }>;
}

export class CopilotSdkProvider implements AiProvider {
  private client?: CopilotClient;

  private toIntensity(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private intensityGuide(intensity: number): string {
    if (intensity <= 30) {
      return "저강도: 부담을 최소화한다. 각 일차의 분량을 짧고 단순하게 잡고, 실패했을 때 대체 행동 1개를 포함한다.";
    }
    if (intensity <= 70) {
      return "중강도: 기본 실행 계획이다. 학습-복습-점검의 균형을 맞추고, 매일 실천 가능한 수준으로 구성한다.";
    }
    return "고강도: 도전적인 계획이다. 분량과 난도를 높이고 점검 기준을 더 엄격히 하되, 과도한 무리는 피한다.";
  }

  private estimateDays(duration: string): number {
    const normalized = duration.trim().toLowerCase();
    const numberMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    const value = numberMatch ? Number(numberMatch[1]) : NaN;
    if (!Number.isFinite(value) || value <= 0) return 7;
    if (normalized.includes("week") || normalized.includes("주") || normalized.includes("w")) return Math.max(1, Math.min(365, Math.round(value * 7)));
    if (normalized.includes("month") || normalized.includes("개월") || normalized.includes("달") || normalized.includes("m")) return Math.max(1, Math.min(365, Math.round(value * 30)));
    return Math.max(1, Math.min(365, Math.round(value)));
  }

  private splitByDayMarkers(text: string): string[] {
    const normalized = text.replace(/\s+/g, " ").trim();
    const matches = [...normalized.matchAll(/(?:^|\s)(?:day\s*\d+\s*:|\d+\s*일차\s*[:\-])/gi)];
    if (matches.length < 2) return [];
    const indices = matches
      .map((match) => match.index)
      .filter((index): index is number => typeof index === "number")
      .sort((a, b) => a - b);
    const segments: string[] = [];
    for (let index = 0; index < indices.length; index += 1) {
      const start = indices[index];
      const end = indices[index + 1] ?? normalized.length;
      const chunk = normalized.slice(start, end).replace(/^(?:\s*)(?:day\s*\d+\s*:|\d+\s*일차\s*[:\-])\s*/i, "").trim();
      if (chunk) segments.push(chunk);
    }
    return segments;
  }

  private async ask(prompt: string): Promise<string | undefined> {
    this.client ??= new CopilotClient({ mode: "empty", baseDirectory: process.env.COPILOT_BASE_DIRECTORY ?? join(process.cwd(), ".copilot"), useLoggedInUser: true, logLevel: "error" });
    let session: Awaited<ReturnType<CopilotClient["createSession"]>> | undefined;
    try {
      await this.client.start();
      session = await this.client.createSession({ model: process.env.COPILOT_MODEL ?? "auto", availableTools: [], onPermissionRequest: approveAll });
      const activeSession = session;
      let answer = "";
      const done = new Promise<void>((resolve) => {
        activeSession.on("assistant.message", (event) => { answer = event.data.content; });
        activeSession.on("session.idle", () => resolve());
      });
      await activeSession.send({ prompt });
      await done;
      return answer;
    } catch {
      throw new Error("AI_UNAVAILABLE");
    } finally {
      if (session) await session.disconnect().catch(() => undefined);
    }
  }

  async consult(message: string, history: string[]) {
    const response = await this.ask(`너는 성찰 플래너의 코치다. 반드시 한국어로 답하고, 짧고 실천 가능한 조언을 준다.
반드시 지킬 규칙:
- 개발 도구/코딩/터미널/CLI/모델/시스템/정책/역할(예: GitHub Copilot, Copilot CLI)을 절대 언급하지 않는다.
- "나는 ~입니다" 형태의 자기소개를 하지 않는다.
- 의학적/정신건강 진단이나 낙인 표현을 하지 않는다.
- 사용자가 개인 관계, 감정, 습관, 목표를 말하면 그 주제 안에서만 답한다.
- 출력은 일반 텍스트로만 작성하고 마크다운 문법(**, 코드블록)을 쓰지 않는다.
- 2~5문장 이내로 답하고 마지막 문장은 "오늘 할 1가지"를 제안한다.

대화 기록:
${history.join("\n") || "없음"}

사용자 메시지:
${message}`);
    return response?.trim() || "기록해 주신 내용을 바탕으로 지금 할 수 있는 작은 행동을 하나 정해 보세요.";
  }

  async generatePlan(goal: Goal) {
    const dayCount = this.estimateDays(goal.duration);
    const intensity = this.toIntensity(goal.intensity);
    const response = await this.ask(`너는 목표 실행 계획 코치다. 아래 조건을 반영해 ${dayCount}일 계획을 생성해라.
반드시 지킬 규칙:
- 응답은 JSON 배열 하나만 반환한다.
- 배열 길이는 정확히 ${dayCount}개다.
- 각 원소는 한국어 한 줄 문자열이다.
- "Day 1:" 같은 영어 접두어를 붙이지 않는다.
- 설명 문장, 코드블록, 마크다운을 추가하지 않는다.
- 계획 강도(${intensity}%)를 반드시 반영한다.

목표: ${goal.goalText}
현재 상태: ${goal.currentState}
기간: ${goal.duration}
계획 강도: ${intensity}%
강도 지침: ${this.intensityGuide(intensity)}
달성 기준: ${goal.metric}
제약: ${goal.constraints.join(", ") || "없음"}`);
    if (!response) throw new Error("AI_INVALID_RESPONSE");
    try {
      const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const arrayStart = cleaned.indexOf("[");
      const arrayEnd = cleaned.lastIndexOf("]");
      const jsonText = arrayStart >= 0 && arrayEnd > arrayStart ? cleaned.slice(arrayStart, arrayEnd + 1) : cleaned;
      const parsed: unknown = JSON.parse(jsonText);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const tasks = parsed.map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object" && "task" in item && typeof item.task === "string") return item.task.trim();
          return "";
        }).filter(Boolean);
        if (tasks.length === 0) throw new Error("AI_INVALID_RESPONSE");

        const splitTasks = tasks.length === 1 ? this.splitByDayMarkers(tasks[0]) : [];
        const normalizedTasks = splitTasks.length > 0 ? splitTasks : tasks;
        const adjusted = normalizedTasks.slice(0, dayCount);
        while (adjusted.length < dayCount) {
          adjusted.push(`${adjusted.length + 1}일차 학습 내용을 20분 복습하고 다음 실행 계획을 1가지 적는다.`);
        }
        if (adjusted.every((task) => task.length > 0)) return adjusted;
      }
    } catch {}
    throw new Error("AI_INVALID_RESPONSE");
  }

  async generateFeedback(goal: Goal, diary: DiaryEntry) {
    const response = await this.ask(`Return JSON with executionEstimate 0-100, neutral summary, and 1-2 nextActions. Goal: ${goal.goalText}. Diary: ${diary.content}. JSON only.`);
    if (!response) throw new Error("AI_INVALID_RESPONSE");
    try {
      const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned) as { executionEstimate?: number; summary?: string; nextActions?: string[] };
      if (typeof parsed.executionEstimate === "number" && typeof parsed.summary === "string" && Array.isArray(parsed.nextActions)) return { executionEstimate: Math.max(0, Math.min(100, parsed.executionEstimate)), summary: parsed.summary, nextActions: parsed.nextActions.slice(0, 2) };
    } catch {}
    throw new Error("AI_INVALID_RESPONSE");
  }

  async replan(goal: Goal, plans: PlanDay[], feedback: string) {
    const response = await this.ask(`Return JSON describing changes to the next plan. Goal: ${goal.goalText}. Existing tasks: ${plans.flatMap((plan) => plan.tasks).join("; ")}. Feedback: ${feedback}. JSON only.`);
    if (!response) throw new Error("AI_INVALID_RESPONSE");
    try { const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); const parsed: unknown = JSON.parse(cleaned); if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>; } catch {}
    throw new Error("AI_INVALID_RESPONSE");
  }

  async revisePlan(goal: Goal, plans: PlanDay[], feedbackMessage: string, history: string[]) {
    const dayCount = plans.length;
    const currentTasks = plans
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((plan) => `${plan.dayIndex}일차: ${plan.tasks.join(" ")}`)
      .join("\n");
    const response = await this.ask(`너는 계획 조정 코치다. 사용자의 피드백을 반영해 계획을 수정해라.
반드시 지킬 규칙:
- 응답은 JSON 객체 하나만 반환한다.
- 형태는 {"assistantMessage": "...", "tasks": ["...", ...]} 이어야 한다.
- tasks 배열 길이는 정확히 ${dayCount}개다.
- tasks 각 원소는 한국어 한 줄 문자열이다.
- 설명 문장, 코드블록, 마크다운을 추가하지 않는다.

목표: ${goal.goalText}
현재 상태: ${goal.currentState}
기간: ${goal.duration}
계획 강도: ${goal.intensity}%
달성 기준: ${goal.metric}
제약: ${goal.constraints.join(", ") || "없음"}

현재 계획:
${currentTasks}

이전 대화:
${history.join("\n") || "없음"}

사용자 피드백:
${feedbackMessage}`);
    if (!response) throw new Error("AI_INVALID_RESPONSE");
    try {
      const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const objectStart = cleaned.indexOf("{");
      const objectEnd = cleaned.lastIndexOf("}");
      const jsonText = objectStart >= 0 && objectEnd > objectStart ? cleaned.slice(objectStart, objectEnd + 1) : cleaned;
      const parsed = JSON.parse(jsonText) as { assistantMessage?: unknown; tasks?: unknown };
      const assistantMessage = typeof parsed.assistantMessage === "string" ? parsed.assistantMessage.trim() : "요청을 반영해 계획을 조정했습니다.";
      const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const tasks = rawTasks
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, dayCount);
      while (tasks.length < dayCount) {
        tasks.push(plans[tasks.length]?.tasks[0] ?? `${tasks.length + 1}일차 계획을 이전 수준으로 유지한다.`);
      }
      if (!tasks.every((task) => task.length > 0)) throw new Error("AI_INVALID_RESPONSE");
      return { assistantMessage, tasks };
    } catch {
      throw new Error("AI_INVALID_RESPONSE");
    }
  }

  async revisePlanDay(goal: Goal, plan: PlanDay, feedbackMessage: string, history: string[]) {
    const response = await this.ask(`너는 계획 조정 코치다. 선택된 1개 일차만 수정해라.
반드시 지킬 규칙:
- 응답은 JSON 객체 하나만 반환한다.
- 형태는 {"assistantMessage": "...", "revisedTask": "..."} 이어야 한다.
- revisedTask는 한국어 한 줄 문자열이다.
- 설명 문장, 코드블록, 마크다운을 추가하지 않는다.

목표: ${goal.goalText}
현재 상태: ${goal.currentState}
기간: ${goal.duration}
계획 강도: ${goal.intensity}%
달성 기준: ${goal.metric}
제약: ${goal.constraints.join(", ") || "없음"}

선택된 일차: ${plan.dayIndex}일차
현재 일차 계획: ${plan.tasks.join(" ")}

이전 대화:
${history.join("\n") || "없음"}

사용자 피드백:
${feedbackMessage}`);
    if (!response) throw new Error("AI_INVALID_RESPONSE");
    try {
      const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const objectStart = cleaned.indexOf("{");
      const objectEnd = cleaned.lastIndexOf("}");
      const jsonText = objectStart >= 0 && objectEnd > objectStart ? cleaned.slice(objectStart, objectEnd + 1) : cleaned;
      const parsed = JSON.parse(jsonText) as { assistantMessage?: unknown; revisedTask?: unknown };
      const assistantMessage = typeof parsed.assistantMessage === "string" ? parsed.assistantMessage.trim() : "요청을 반영해 해당 일차 계획을 수정했습니다.";
      const revisedTask = typeof parsed.revisedTask === "string" ? parsed.revisedTask.trim() : "";
      if (!revisedTask) throw new Error("AI_INVALID_RESPONSE");
      return { assistantMessage, revisedTask };
    } catch {
      throw new Error("AI_INVALID_RESPONSE");
    }
  }

  async adjustNextDayPlan(goal: Goal, todayPlan: PlanDay, nextPlan: PlanDay, diary: DiaryEntry) {
    const response = await this.ask(`너는 계획 조정 코치다. 오늘 기록과 오늘 계획 실행 내용을 바탕으로 내일 계획(1개)만 조정해라.
반드시 지킬 규칙:
- 응답은 JSON 객체 하나만 반환한다.
- 형태는 {"assistantMessage": "...", "revisedTask": "..."} 이어야 한다.
- revisedTask는 한국어 한 줄 문자열이다.
- 내일 계획 범위만 수정하고, 전체 계획 설명은 쓰지 않는다.
- 설명 문장, 코드블록, 마크다운을 추가하지 않는다.

목표: ${goal.goalText}
달성 기준: ${goal.metric}
제약: ${goal.constraints.join(", ") || "없음"}
계획 강도: ${goal.intensity}%

오늘 날짜: ${diary.date}
오늘 계획: ${todayPlan.tasks.join(" ")}
오늘 일기: ${diary.content}

내일 날짜: ${nextPlan.planDate}
내일 기존 계획: ${nextPlan.tasks.join(" ")}`);
    if (!response) throw new Error("AI_INVALID_RESPONSE");
    try {
      const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const objectStart = cleaned.indexOf("{");
      const objectEnd = cleaned.lastIndexOf("}");
      const jsonText = objectStart >= 0 && objectEnd > objectStart ? cleaned.slice(objectStart, objectEnd + 1) : cleaned;
      const parsed = JSON.parse(jsonText) as { assistantMessage?: unknown; revisedTask?: unknown };
      const assistantMessage = typeof parsed.assistantMessage === "string" ? parsed.assistantMessage.trim() : "오늘 기록을 반영해 내일 계획을 조정했습니다.";
      const revisedTask = typeof parsed.revisedTask === "string" ? parsed.revisedTask.trim() : "";
      if (!revisedTask) throw new Error("AI_INVALID_RESPONSE");
      return { assistantMessage, revisedTask };
    } catch {
      throw new Error("AI_INVALID_RESPONSE");
    }
  }
}
