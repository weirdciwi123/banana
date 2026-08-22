import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import { consultationInputSchema, createId, diaryInputSchema, decisionInputSchema, goalInputSchema, nextDayPlanApplyInputSchema, now, planDayUpdateInputSchema, planFeedbackInputSchema } from "./domain.js";
import { CopilotSdkProvider } from "./ai.js";
import { MemoryStore } from "./store.js";
import { MicrosoftAgentWorkflow } from "./workflow.js";
import type { Goal } from "./domain.js";

const app = Fastify({ logger: { redact: ["req.headers.cookie", "req.body.content", "req.body.goalText"] } });
const store = new MemoryStore();
const workflow = new MicrosoftAgentWorkflow(new CopilotSdkProvider());
const cookieName = "reflection_session";
const requestCounts = new Map<string, { count: number; startedAt: number }>();
const maxRequests = 60;
const windowMs = 60_000;

await app.register(cookie);
await app.register(cors, { origin: process.env.ALLOWED_ORIGIN ?? false, credentials: true });
await app.register(fastifyStatic, { root: join(process.cwd(), "public"), index: "index.html" });

app.get("/", async (_request, reply) => reply.type("text/html").sendFile("index.html"));

const sessionId = (request: { cookies: Record<string, string | undefined> }) => request.cookies[cookieName];
const requireSession = (request: { cookies: Record<string, string | undefined> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
  const id = sessionId(request);
  if (!id) { reply.code(401).send({ code: "SESSION_REQUIRED", message: "익명 세션이 필요합니다." }); return undefined; }
  const current = requestCounts.get(id) ?? { count: 0, startedAt: Date.now() };
  if (Date.now() - current.startedAt >= windowMs) { current.count = 0; current.startedAt = Date.now(); }
  current.count += 1;
  requestCounts.set(id, current);
  if (current.count > maxRequests) { reply.code(429).send({ code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요." }); return undefined; }
  return id;
};

const parseDayIndex = (input: string) => {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
};

app.get("/health", async () => ({ status: "ok" }));

app.post("/guest/session", async (_request, reply) => {
  const id = createId();
  reply.setCookie(cookieName, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return reply.code(201).send({ data: { created: true } });
});

app.get("/consultation/messages", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  return { data: store.getMessages(id) };
});

app.post<{ Body: unknown }>("/consultation/messages", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const parsed = consultationInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "상담 메시지를 확인해 주세요." });
  const userMessage = { messageId: createId(), guestSessionId: id, role: "user" as const, content: parsed.data.message, createdAt: now() };
  store.saveMessage(userMessage);
  try {
    const assistantMessage = await workflow.consult(id, parsed.data.message, store.getMessages(id));
    store.saveMessage(assistantMessage);
    return reply.code(201).send({ data: { userMessage, assistantMessage } });
  } catch (error) {
    if (error instanceof Error && error.message === "POLICY_BLOCKED") return reply.code(422).send({ code: "POLICY_BLOCKED", message: "정책 검증을 통과하지 못했습니다." });
    throw error;
  }
});

app.delete("/guest/session", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  store.deleteSession(id);
  requestCounts.delete(id);
  reply.clearCookie(cookieName, { path: "/" });
  return reply.code(204).send();
});

app.post<{ Body: unknown }>("/goals", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const parsed = goalInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "목표 입력을 확인해 주세요." });
  const goal: Goal = { ...parsed.data, goalId: createId(), guestSessionId: id, createdAt: now(), updatedAt: now() };
  store.saveGoal(goal);
  return reply.code(201).send({ data: goal });
});

app.post<{ Params: { goalId: string } }>("/goals/:goalId/plans:generate", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const goal = store.getGoal(request.params.goalId, id);
  if (!goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  const plans = await workflow.createPlan(goal);
  for (const plan of plans) store.savePlan(plan);
  return reply.code(201).send({ data: plans });
});

app.get<{ Params: { goalId: string } }>("/goals/:goalId/plans", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  if (!store.getGoal(request.params.goalId, id)) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  return { data: store.getPlansForGoal(request.params.goalId, id) };
});

app.post<{ Params: { goalId: string }; Body: unknown }>("/goals/:goalId/diaries", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const goal = store.getGoal(request.params.goalId, id);
  const parsed = diaryInputSchema.safeParse(request.body);
  if (!goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "일기 입력을 확인해 주세요." });
  const diary = { ...parsed.data, diaryId: createId(), goalId: goal.goalId, guestSessionId: id, createdAt: now(), updatedAt: now() };
  store.saveDiary(diary);
  return reply.code(201).send({ data: diary });
});

app.get<{ Params: { goalId: string } }>("/goals/:goalId/diaries", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  if (!store.getGoal(request.params.goalId, id)) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  return { data: store.getDiaries(request.params.goalId, id) };
});

app.post<{ Params: { diaryId: string } }>("/diaries/:diaryId/feedback:generate", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const diary = store.getDiary(request.params.diaryId, id);
  const goal = diary ? store.getGoal(diary.goalId, id) : undefined;
  if (!diary || !goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  try { const feedback = await workflow.createFeedback(goal, diary); store.saveFeedback(feedback); return reply.code(201).send({ data: feedback }); } catch (error) { if (error instanceof Error && error.message === "POLICY_BLOCKED") return reply.code(422).send({ code: "POLICY_BLOCKED", message: "정책 검증을 통과하지 못했습니다." }); throw error; }
});

app.post<{ Params: { diaryId: string } }>("/diaries/:diaryId/next-day-plan:adjust", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;

  const diary = store.getDiary(request.params.diaryId, id);
  const goal = diary ? store.getGoal(diary.goalId, id) : undefined;
  if (!diary || !goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });

  const goalPlans = store.getPlansForGoal(goal.goalId, id).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  if (goalPlans.length === 0) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  const todayPlan = goalPlans.find((plan) => plan.planDate === diary.date);
  if (!todayPlan) return reply.code(404).send({ code: "PLAN_DAY_NOT_FOUND", message: "일기 날짜에 해당하는 계획을 찾을 수 없습니다." });

  const samePlanDays = store.getPlans(todayPlan.planId, id).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const hasNextDay = samePlanDays.some((plan) => plan.dayIndex === todayPlan.dayIndex + 1);
  if (!hasNextDay) return reply.code(409).send({ code: "NEXT_PLAN_NOT_FOUND", message: "조정할 다음날 계획이 없습니다." });

  try {
    const result = await workflow.previewNextDayAdjustmentFromDiary(goal, samePlanDays, diary);

    return reply.code(201).send({
      data: {
        planId: todayPlan.planId,
        adjustedDayIndex: result.adjustedDayIndex,
        previousTask: result.previousTask,
        revisedTask: result.revisedTask,
        assistantMessage: result.assistantMessage,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_DAY_NOT_FOUND") return reply.code(404).send({ code: "PLAN_DAY_NOT_FOUND", message: "일기 날짜에 해당하는 계획을 찾을 수 없습니다." });
    if (error instanceof Error && error.message === "NEXT_PLAN_NOT_FOUND") return reply.code(409).send({ code: "NEXT_PLAN_NOT_FOUND", message: "조정할 다음날 계획이 없습니다." });
    if (error instanceof Error && error.message === "POLICY_BLOCKED") return reply.code(422).send({ code: "POLICY_BLOCKED", message: "정책 검증을 통과하지 못했습니다." });
    throw error;
  }
});

app.post<{ Params: { diaryId: string }; Body: unknown }>("/diaries/:diaryId/next-day-plan:apply", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;

  const parsed = nextDayPlanApplyInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "다음날 계획 적용 입력을 확인해 주세요." });

  const diary = store.getDiary(request.params.diaryId, id);
  const goal = diary ? store.getGoal(diary.goalId, id) : undefined;
  if (!diary || !goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });

  const goalPlans = store.getPlansForGoal(goal.goalId, id).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  if (goalPlans.length === 0) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  const todayPlan = goalPlans.find((plan) => plan.planDate === diary.date);
  if (!todayPlan) return reply.code(404).send({ code: "PLAN_DAY_NOT_FOUND", message: "일기 날짜에 해당하는 계획을 찾을 수 없습니다." });

  const samePlanDays = store.getPlans(todayPlan.planId, id).slice().sort((a, b) => a.dayIndex - b.dayIndex);

  try {
    const result = workflow.applyNextDayAdjustment(goal, samePlanDays, diary, parsed.data.adjustedDayIndex, parsed.data.revisedTask);
    store.replacePlans(todayPlan.planId, result.updatedPlans);
    store.saveDecision(result.decision);

    const userMessage = {
      messageId: createId(),
      planId: todayPlan.planId,
      dayIndex: result.adjustedDayIndex,
      guestSessionId: id,
      role: "user" as const,
      content: `오늘 기록 반영으로 다음날 계획 조정 요청: ${diary.content}`,
      createdAt: now(),
    };
    const assistantMessage = {
      messageId: createId(),
      planId: todayPlan.planId,
      dayIndex: result.adjustedDayIndex,
      guestSessionId: id,
      role: "assistant" as const,
      content: parsed.data.assistantMessage ?? "오늘 기록을 반영해 다음날 계획을 조정했습니다.",
      createdAt: now(),
    };
    store.savePlanMessage(userMessage);
    store.savePlanMessage(assistantMessage);

    return reply.code(201).send({
      data: {
        plans: result.updatedPlans,
        adjustedDayIndex: result.adjustedDayIndex,
        previousTask: result.previousTask,
        revisedTask: result.revisedTask,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_DAY_NOT_FOUND") return reply.code(404).send({ code: "PLAN_DAY_NOT_FOUND", message: "일기 날짜에 해당하는 계획을 찾을 수 없습니다." });
    if (error instanceof Error && error.message === "NEXT_PLAN_NOT_FOUND") return reply.code(409).send({ code: "NEXT_PLAN_NOT_FOUND", message: "조정할 다음날 계획이 없습니다." });
    if (error instanceof Error && error.message === "INVALID_TARGET_DAY") return reply.code(400).send({ code: "INVALID_INPUT", message: "적용 대상 일차가 올바르지 않습니다." });
    if (error instanceof Error && error.message === "INVALID_PLAN_TASK") return reply.code(400).send({ code: "INVALID_INPUT", message: "적용할 계획 문장을 확인해 주세요." });
    throw error;
  }
});

app.get<{ Params: { diaryId: string } }>("/diaries/:diaryId/feedback", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const diary = store.getDiary(request.params.diaryId, id);
  const feedback = store.getFeedbackForDiary(request.params.diaryId, id);
  if (!diary || !feedback) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  return { data: feedback };
});

app.post<{ Params: { planId: string }; Body: unknown }>("/plans/:planId/decisions", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const parsed = decisionInputSchema.safeParse(request.body);
  const plan = store.getPlan(request.params.planId, id);
  const goal = plan ? store.getGoal(plan.goalId, id) : undefined;
  if (!plan || !goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "결정 입력을 확인해 주세요." });
  if (parsed.data.type === "reject") { const decision = { decisionId: createId(), planId: plan.planId, guestSessionId: id, type: "reject" as const, proposedChanges: {}, changedFields: [], createdAt: now() }; store.saveDecision(decision); return { data: { decision, plans: store.getPlans(plan.planId, id) } }; }
  const result = await workflow.replan(goal, store.getPlans(plan.planId, id), JSON.stringify(parsed.data.proposedChanges ?? "사용자가 제안 수용"));
  const updated = store.getPlans(plan.planId, id).map((item) => ({ ...item, tasks: item.tasks.map((task) => `${task} (조정 반영)`), updatedAt: now() }));
  store.replacePlans(plan.planId, updated);
  store.saveDecision({ ...result.decision, type: "accept" });
  return { data: { decision: result.decision, plans: updated } };
});

app.get<{ Params: { planId: string } }>("/plans/:planId/feedback-messages", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  if (!store.getPlan(request.params.planId, id)) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  return { data: store.getPlanMessages(request.params.planId, id) };
});

app.get<{ Params: { planId: string; dayIndex: string } }>("/plans/:planId/days/:dayIndex/feedback-messages", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const dayIndex = parseDayIndex(request.params.dayIndex);
  if (!dayIndex) return reply.code(400).send({ code: "INVALID_INPUT", message: "일차 값을 확인해 주세요." });
  if (!store.getPlan(request.params.planId, id)) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  return { data: store.getPlanMessages(request.params.planId, id, dayIndex) };
});

app.post<{ Params: { planId: string }; Body: unknown }>("/plans/:planId/feedback:apply", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const parsed = planFeedbackInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "피드백 메시지를 확인해 주세요." });

  const plan = store.getPlan(request.params.planId, id);
  const goal = plan ? store.getGoal(plan.goalId, id) : undefined;
  if (!plan || !goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });

  const existingPlans = store.getPlans(plan.planId, id).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const history = store.getPlanMessages(plan.planId, id).map((message) => `${message.role}: ${message.content}`);

  try {
    const result = await workflow.applyPlanFeedback(goal, existingPlans, parsed.data.message, history);
    store.replacePlans(plan.planId, result.updatedPlans);
    store.saveDecision(result.decision);

    const userMessage = { messageId: createId(), planId: plan.planId, dayIndex: 0, guestSessionId: id, role: "user" as const, content: parsed.data.message, createdAt: now() };
    const assistantMessage = { messageId: createId(), planId: plan.planId, dayIndex: 0, guestSessionId: id, role: "assistant" as const, content: result.assistantMessage, createdAt: now() };
    store.savePlanMessage(userMessage);
    store.savePlanMessage(assistantMessage);

    return reply.code(201).send({ data: { plans: result.updatedPlans, messages: store.getPlanMessages(plan.planId, id), decision: result.decision } });
  } catch (error) {
    if (error instanceof Error && error.message === "POLICY_BLOCKED") return reply.code(422).send({ code: "POLICY_BLOCKED", message: "정책 검증을 통과하지 못했습니다." });
    throw error;
  }
});

app.post<{ Params: { planId: string; dayIndex: string }; Body: unknown }>("/plans/:planId/days/:dayIndex/feedback:apply", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const dayIndex = parseDayIndex(request.params.dayIndex);
  if (!dayIndex) return reply.code(400).send({ code: "INVALID_INPUT", message: "일차 값을 확인해 주세요." });
  const parsed = planFeedbackInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "피드백 메시지를 확인해 주세요." });

  const plan = store.getPlan(request.params.planId, id);
  const goal = plan ? store.getGoal(plan.goalId, id) : undefined;
  if (!plan || !goal) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });

  const existingPlans = store.getPlans(plan.planId, id).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const history = store.getPlanMessages(plan.planId, id, dayIndex).map((message) => `${message.role}: ${message.content}`);

  try {
    const result = await workflow.applyPlanDayFeedback(goal, existingPlans, dayIndex, parsed.data.message, history);
    store.replacePlans(plan.planId, result.updatedPlans);
    store.saveDecision(result.decision);

    const userMessage = { messageId: createId(), planId: plan.planId, dayIndex, guestSessionId: id, role: "user" as const, content: parsed.data.message, createdAt: now() };
    const assistantMessage = { messageId: createId(), planId: plan.planId, dayIndex, guestSessionId: id, role: "assistant" as const, content: result.assistantMessage, createdAt: now() };
    store.savePlanMessage(userMessage);
    store.savePlanMessage(assistantMessage);

    return reply.code(201).send({ data: { plans: result.updatedPlans, messages: store.getPlanMessages(plan.planId, id, dayIndex), decision: result.decision } });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_DAY_NOT_FOUND") return reply.code(404).send({ code: "NOT_FOUND", message: "선택한 일차를 찾을 수 없습니다." });
    if (error instanceof Error && error.message === "POLICY_BLOCKED") return reply.code(422).send({ code: "POLICY_BLOCKED", message: "정책 검증을 통과하지 못했습니다." });
    throw error;
  }
});

app.patch<{ Params: { planId: string; dayIndex: string }; Body: unknown }>("/plans/:planId/days/:dayIndex", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  const dayIndex = parseDayIndex(request.params.dayIndex);
  if (!dayIndex) return reply.code(400).send({ code: "INVALID_INPUT", message: "일차 값을 확인해 주세요." });
  const parsed = planDayUpdateInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_INPUT", message: "수정 내용을 확인해 주세요." });

  const plan = store.getPlan(request.params.planId, id);
  if (!plan) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });

  const existingPlans = store.getPlans(plan.planId, id).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  try {
    const updatedPlans = workflow.updatePlanDayDirectly(existingPlans, dayIndex, parsed.data.task);
    store.replacePlans(plan.planId, updatedPlans);
    return { data: { plans: updatedPlans } };
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_DAY_NOT_FOUND") return reply.code(404).send({ code: "NOT_FOUND", message: "선택한 일차를 찾을 수 없습니다." });
    if (error instanceof Error && error.message === "INVALID_PLAN_TASK") return reply.code(400).send({ code: "INVALID_INPUT", message: "수정 내용을 확인해 주세요." });
    throw error;
  }
});

app.get<{ Params: { planId: string } }>("/plans/:planId/decisions", async (request, reply) => {
  const id = requireSession(request, reply);
  if (!id) return;
  if (!store.getPlan(request.params.planId, id)) return reply.code(404).send({ code: "NOT_FOUND", message: "리소스를 찾을 수 없습니다." });
  return { data: store.getDecisions(request.params.planId, id) };
});

app.setErrorHandler((error, _request, reply) => { app.log.error(error); const candidate = error as { statusCode?: unknown; message?: unknown }; if (candidate.message === "AI_UNAVAILABLE") return reply.code(503).send({ code: "AI_UNAVAILABLE", message: "AI 서비스를 사용할 수 없습니다. Copilot CLI 인증과 모델 설정을 확인해 주세요." }); if (candidate.message === "AI_INVALID_RESPONSE") return reply.code(502).send({ code: "AI_INVALID_RESPONSE", message: "AI가 올바른 계획 형식으로 응답하지 않았습니다. 다시 시도해 주세요." }); const statusCode = typeof candidate.statusCode === "number" && candidate.statusCode >= 400 && candidate.statusCode < 500 ? candidate.statusCode : 500; return reply.code(statusCode).send({ code: statusCode === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST", message: statusCode === 500 ? "요청을 처리하지 못했습니다." : "요청 형식을 확인해 주세요." }); });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });
