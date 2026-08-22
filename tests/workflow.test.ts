import { describe, expect, it } from "vitest";
import { MicrosoftAgentWorkflow } from "../src/workflow.js";
import type { AiProvider } from "../src/ai.js";
import type { Goal } from "../src/domain.js";
import type { AgentFrameworkRuntime } from "../src/agent-framework.js";

const goal: Goal = {
  goalId: "goal-1",
  guestSessionId: "session-1",
  goalText: "책 읽기",
  currentState: "주 1회",
  duration: "7d",
  intensity: 50,
  constraints: ["하루 20분"],
  metric: "주 3회",
  optionalAttributes: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const provider: AiProvider = {
  consult: async () => "지금 할 수 있는 작은 행동을 하나 정해 보세요.",
  generatePlan: async () => ["Day 1: 20분 읽기", "Day 2: 읽은 내용 기록하기"],
  generateFeedback: async () => ({ executionEstimate: 120, summary: "기록된 내용을 요약했습니다.", nextActions: ["다음 행동을 정합니다.", "실행 시간을 정합니다.", "제외됩니다."] }),
  replan: async () => ({ adjustment: "reduce_scope" }),
  revisePlan: async () => ({ assistantMessage: "요청을 반영해 계획을 수정했습니다.", tasks: ["20분 읽기", "읽은 내용 기록하기"] }),
  revisePlanDay: async () => ({ assistantMessage: "요청을 반영해 해당 일차를 수정했습니다.", revisedTask: "20분 읽기" }),
  adjustNextDayPlan: async () => ({ assistantMessage: "오늘 기록을 반영해 내일 계획을 조정했습니다.", revisedTask: "핵심 문단 10분 읽고 5줄 요약하기" }),
};

describe("MicrosoftAgentWorkflow", () => {
  it("routes provider calls through agent framework runtime", async () => {
    const operations: string[] = [];
    const runtime: AgentFrameworkRuntime = {
      run: async (operation, task) => {
        operations.push(operation);
        return task();
      },
      isConnected: async () => true,
    };

    const workflow = new MicrosoftAgentWorkflow(provider, runtime);
    await workflow.createPlan(goal);
    await workflow.consult("session-1", "테스트", []);

    expect(operations).toContain("createPlan");
    expect(operations).toContain("consult");
  });

  it("groups generated days under one plan", async () => {
    const plans = await new MicrosoftAgentWorkflow(provider).createPlan(goal);
    expect(plans).toHaveLength(2);
    expect(new Set(plans.map((plan) => plan.planId)).size).toBe(1);
    expect(plans.map((plan) => plan.dayIndex)).toEqual([1, 2]);
    expect(plans.map((plan) => plan.tasks[0])).toEqual(["20분 읽기", "읽은 내용 기록하기"]);
  });

  it("normalizes feedback and limits next actions", async () => {
    const workflow = new MicrosoftAgentWorkflow(provider);
    const feedback = await workflow.createFeedback(goal, { diaryId: "diary-1", goalId: goal.goalId, guestSessionId: goal.guestSessionId, date: "2026-08-22", content: "실행 기록", createdAt: goal.createdAt, updatedAt: goal.updatedAt });
    expect(feedback.executionEstimate).toBe(100);
    expect(feedback.nextActions).toHaveLength(2);
    expect(feedback.policyPassed).toBe(true);
  });

  it("creates a consultation response for an anonymous session", async () => {
    const message = await new MicrosoftAgentWorkflow(provider).consult("session-1", "오늘 계획을 세우고 싶어요.", []);
    expect(message.role).toBe("assistant");
    expect(message.guestSessionId).toBe("session-1");
  });

  it("blocks prohibited consultation output", async () => {
    const unsafeProvider: AiProvider = { ...provider, consult: async () => "당신은 진단이 필요합니다." };
    await expect(new MicrosoftAgentWorkflow(unsafeProvider).consult("session-1", "도와줘", [])).rejects.toThrow("POLICY_BLOCKED");
  });

  it("replaces meta consultation response with coaching fallback", async () => {
    const metaProvider: AiProvider = {
      ...provider,
      consult: async () => "저는 GitHub Copilot CLI로 소프트웨어 개발 작업을 돕는 터미널 어시스턴트입니다.",
    };
    const message = await new MicrosoftAgentWorkflow(metaProvider).consult("session-1", "여자친구 사귀고 싶다", []);
    expect(message.content).toContain("오늘 할 1가지");
    expect(message.content.toLowerCase()).not.toContain("copilot");
    expect(message.content).not.toContain("소프트웨어 개발");
  });

  it("previews next day adjustment from diary reflection", async () => {
    const workflow = new MicrosoftAgentWorkflow(provider);
    const plans = await workflow.createPlan(goal);
    const firstDay = plans[0];
    expect(firstDay).toBeDefined();
    if (!firstDay) return;
    const result = await workflow.previewNextDayAdjustmentFromDiary(goal, plans, {
      diaryId: "diary-1",
      goalId: goal.goalId,
      guestSessionId: goal.guestSessionId,
      date: firstDay.planDate,
      content: "오늘은 20분 읽기 중 10분만 했고 집중이 잘 안 됐다.",
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    });

    expect(result.adjustedDayIndex).toBe(2);
    expect(result.revisedTask).toBe("핵심 문단 10분 읽고 5줄 요약하기");
  });

  it("applies next day adjustment after confirmation", async () => {
    const workflow = new MicrosoftAgentWorkflow(provider);
    const plans = await workflow.createPlan(goal);
    const firstDay = plans[0];
    expect(firstDay).toBeDefined();
    if (!firstDay) return;

    const applied = workflow.applyNextDayAdjustment(
      goal,
      plans,
      {
        diaryId: "diary-1",
        goalId: goal.goalId,
        guestSessionId: goal.guestSessionId,
        date: firstDay.planDate,
        content: "오늘은 20분 읽기 중 10분만 했고 집중이 잘 안 됐다.",
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
      },
      2,
      "핵심 문단 10분 읽고 5줄 요약하기",
    );

    const secondDay = applied.updatedPlans[1];
    expect(secondDay).toBeDefined();
    if (!secondDay) return;
    expect(secondDay.tasks[0]).toBe("핵심 문단 10분 읽고 5줄 요약하기");
    expect(applied.decision.changedFields).toContain("day:2:tasks");
  });
});
