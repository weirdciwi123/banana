import { createId, now } from "./domain.js";
import type { AiProvider } from "./ai.js";
import type { ConversationMessage, DiaryEntry, Feedback, Goal, PlanDay, ReplanDecision } from "./domain.js";

const prohibited = ["게으르", "무능", "의지가 약", "실패자", "진단"];

export class MicrosoftAgentWorkflow {
  constructor(private readonly provider: AiProvider) {}

  private addDays(baseDate: Date, days: number) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + days);
    return date;
  }

  private toIsoDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  async createPlan(goal: Goal): Promise<PlanDay[]> {
    const tasks = await this.provider.generatePlan(goal);
    const planId = createId();
    const startDate = new Date(goal.startDate ?? this.toIsoDate(new Date()));
    return tasks.map((task, index) => ({
      planDayId: createId(),
      planId,
      goalId: goal.goalId,
      guestSessionId: goal.guestSessionId,
      dayIndex: index + 1,
      planDate: this.toIsoDate(this.addDays(startDate, index)),
      tasks: [task.replace(/^(?:Day\s*\d+\s*:\s*|\d+\s*일차(?:는)?\s*[:\-]?\s*)/i, "").trim()],
      status: "planned",
      createdAt: now(),
      updatedAt: now(),
    }));
  }

  async consult(sessionId: string, message: string, history: ConversationMessage[]): Promise<ConversationMessage> {
    const response = await this.provider.consult(message, history.map((item) => `${item.role}: ${item.content}`));
    const combined = response.toLowerCase();
    if (!response || prohibited.some((word) => combined.includes(word))) throw new Error("POLICY_BLOCKED");
    return { messageId: createId(), guestSessionId: sessionId, role: "assistant", content: response, createdAt: now() };
  }

  async createFeedback(goal: Goal, diary: DiaryEntry): Promise<Feedback> {
    const result = await this.provider.generateFeedback(goal, diary);
    const normalized = {
      executionEstimate: Math.max(0, Math.min(100, Math.round(result.executionEstimate))),
      summary: result.summary.trim(),
      nextActions: result.nextActions.map((action) => action.trim()).filter(Boolean).slice(0, 2),
    };
    const combined = `${normalized.summary} ${normalized.nextActions.join(" ")}`;
    if (!normalized.summary || normalized.nextActions.length === 0 || prohibited.some((word) => combined.includes(word))) throw new Error("POLICY_BLOCKED");
    return { feedbackId: createId(), diaryId: diary.diaryId, guestSessionId: diary.guestSessionId, ...normalized, policyPassed: true, createdAt: now() };
  }

  async replan(goal: Goal, plans: PlanDay[], feedback: string): Promise<{ changes: Record<string, unknown>; decision: ReplanDecision }> {
    const changes = await this.provider.replan(goal, plans, feedback);
    const changedFields = Object.keys(changes);
    return { changes, decision: { decisionId: createId(), planId: plans[0]?.planId ?? "", guestSessionId: goal.guestSessionId, type: "accept", proposedChanges: changes, changedFields, createdAt: now() } };
  }

  async applyPlanFeedback(goal: Goal, plans: PlanDay[], feedbackMessage: string, history: string[]) {
    const revision = await this.provider.revisePlan(goal, plans, feedbackMessage, history);
    const normalizedTasks = revision.tasks.map((task) => task.replace(/^(?:Day\s*\d+\s*:\s*|\d+\s*일차\s*[:\-]?\s*)/i, "").trim());
    const combined = `${revision.assistantMessage} ${normalizedTasks.join(" ")}`.toLowerCase();
    if (!revision.assistantMessage || normalizedTasks.length !== plans.length || prohibited.some((word) => combined.includes(word))) throw new Error("POLICY_BLOCKED");

    const updatedPlans = plans
      .slice()
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((plan, index) => ({
        ...plan,
        tasks: [normalizedTasks[index] || plan.tasks[0] || "기존 계획 유지"],
        updatedAt: now(),
      }));

    const decision: ReplanDecision = {
      decisionId: createId(),
      planId: plans[0]?.planId ?? "",
      guestSessionId: goal.guestSessionId,
      type: "accept",
      proposedChanges: { feedbackMessage, updatedByChat: true },
      changedFields: ["tasks"],
      createdAt: now(),
    };

    return { updatedPlans, assistantMessage: revision.assistantMessage.trim(), decision };
  }

  async applyPlanDayFeedback(goal: Goal, plans: PlanDay[], dayIndex: number, feedbackMessage: string, history: string[]) {
    const target = plans.find((plan) => plan.dayIndex === dayIndex);
    if (!target) throw new Error("PLAN_DAY_NOT_FOUND");
    const revision = await this.provider.revisePlanDay(goal, target, feedbackMessage, history);
    const revisedTask = revision.revisedTask.replace(/^(?:Day\s*\d+\s*:\s*|\d+\s*일차(?:는)?\s*[:\-]?\s*)/i, "").trim();
    const combined = `${revision.assistantMessage} ${revisedTask}`.toLowerCase();
    if (!revision.assistantMessage || !revisedTask || prohibited.some((word) => combined.includes(word))) throw new Error("POLICY_BLOCKED");

    const updatedPlans = plans.map((plan) => {
      if (plan.dayIndex !== dayIndex) return plan;
      return { ...plan, tasks: [revisedTask], updatedAt: now() };
    });

    const decision: ReplanDecision = {
      decisionId: createId(),
      planId: plans[0]?.planId ?? "",
      guestSessionId: goal.guestSessionId,
      type: "accept",
      proposedChanges: { feedbackMessage, dayIndex, updatedByChat: true },
      changedFields: [`day:${dayIndex}:tasks`],
      createdAt: now(),
    };

    return { updatedPlans, assistantMessage: revision.assistantMessage.trim(), decision };
  }

  updatePlanDayDirectly(plans: PlanDay[], dayIndex: number, task: string) {
    const normalizedTask = task.replace(/^(?:Day\s*\d+\s*:\s*|\d+\s*일차(?:는)?\s*[:\-]?\s*)/i, "").trim();
    if (!normalizedTask) throw new Error("INVALID_PLAN_TASK");
    const target = plans.find((plan) => plan.dayIndex === dayIndex);
    if (!target) throw new Error("PLAN_DAY_NOT_FOUND");
    return plans.map((plan) => {
      if (plan.dayIndex !== dayIndex) return plan;
      return { ...plan, tasks: [normalizedTask], updatedAt: now() };
    });
  }
}
