import type { ConversationMessage, DiaryEntry, Feedback, Goal, PlanConversationMessage, PlanDay, ReplanDecision } from "./domain.js";

export class MemoryStore {
  private readonly goals = new Map<string, Goal>();
  private readonly plans = new Map<string, PlanDay[]>();
  private readonly diaries = new Map<string, DiaryEntry>();
  private readonly feedback = new Map<string, Feedback>();
  private readonly decisions = new Map<string, ReplanDecision>();
  private readonly messages = new Map<string, ConversationMessage[]>();
  private readonly planMessages = new Map<string, PlanConversationMessage[]>();

  saveGoal(goal: Goal) { this.goals.set(goal.goalId, goal); return goal; }
  getGoal(goalId: string, sessionId: string) { const goal = this.goals.get(goalId); return goal?.guestSessionId === sessionId ? goal : undefined; }
  savePlan(plan: PlanDay) { const items = this.plans.get(plan.planId) ?? []; items.push(plan); this.plans.set(plan.planId, items); return plan; }
  getPlans(planId: string, sessionId: string) { return (this.plans.get(planId) ?? []).filter((plan) => plan.guestSessionId === sessionId); }
  getPlan(planId: string, sessionId: string) { return this.getPlans(planId, sessionId)[0]; }
  getPlansForGoal(goalId: string, sessionId: string) { return [...this.plans.values()].flat().filter((plan) => plan.goalId === goalId && plan.guestSessionId === sessionId); }
  replacePlans(planId: string, plans: PlanDay[]) { this.plans.set(planId, plans); }
  saveDiary(diary: DiaryEntry) { this.diaries.set(diary.diaryId, diary); return diary; }
  getDiary(diaryId: string, sessionId: string) { const diary = this.diaries.get(diaryId); return diary?.guestSessionId === sessionId ? diary : undefined; }
  getDiaries(goalId: string, sessionId: string) { return [...this.diaries.values()].filter((diary) => diary.goalId === goalId && diary.guestSessionId === sessionId); }
  saveFeedback(item: Feedback) { this.feedback.set(item.feedbackId, item); return item; }
  getFeedbackForDiary(diaryId: string, sessionId: string) { return [...this.feedback.values()].find((item) => item.diaryId === diaryId && item.guestSessionId === sessionId); }
  saveDecision(item: ReplanDecision) { this.decisions.set(item.decisionId, item); return item; }
  getDecisions(planId: string, sessionId: string) { return [...this.decisions.values()].filter((item) => item.planId === planId && item.guestSessionId === sessionId); }
  saveMessage(message: ConversationMessage) { const items = this.messages.get(message.guestSessionId) ?? []; items.push(message); this.messages.set(message.guestSessionId, items); return message; }
  getMessages(sessionId: string) { return this.messages.get(sessionId) ?? []; }
  savePlanMessage(message: PlanConversationMessage) {
    const items = this.planMessages.get(message.planId) ?? [];
    items.push(message);
    this.planMessages.set(message.planId, items);
    return message;
  }
  getPlanMessages(planId: string, sessionId: string, dayIndex?: number) {
    return (this.planMessages.get(planId) ?? []).filter((message) => {
      if (message.guestSessionId !== sessionId) return false;
      if (typeof dayIndex === "number") return message.dayIndex === dayIndex;
      return true;
    });
  }
  deleteSession(sessionId: string) {
    for (const [id, value] of this.goals) if (value.guestSessionId === sessionId) this.goals.delete(id);
    for (const [id, value] of this.diaries) if (value.guestSessionId === sessionId) this.diaries.delete(id);
    for (const [id, value] of this.feedback) if (value.guestSessionId === sessionId) this.feedback.delete(id);
    for (const [id, value] of this.decisions) if (value.guestSessionId === sessionId) this.decisions.delete(id);
    for (const [id, value] of this.plans) if (value.some((plan) => plan.guestSessionId === sessionId)) this.plans.delete(id);
    for (const [id, value] of this.planMessages) if (value.some((message) => message.guestSessionId === sessionId)) this.planMessages.delete(id);
    this.messages.delete(sessionId);
  }
}
