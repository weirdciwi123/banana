import { describe, expect, it } from "vitest";
import { MicrosoftAgentWorkflow } from "../src/workflow.js";
import type { AiProvider } from "../src/ai.js";
import type { Goal } from "../src/domain.js";

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
};

describe("MicrosoftAgentWorkflow", () => {
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
});
