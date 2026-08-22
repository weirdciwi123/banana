import { randomUUID } from "node:crypto";
import { z } from "zod";

export const goalInputSchema = z.object({
  goalText: z.string().trim().min(1).max(2000),
  currentState: z.string().trim().min(1).max(4000),
  duration: z.string().trim().min(1).max(100),
  startDate: z.string().date().optional(),
  intensity: z.coerce.number().int().min(0).max(100).default(50),
  constraints: z.array(z.string().trim().min(1).max(500)).max(20),
  metric: z.string().trim().min(1).max(1000),
  optionalAttributes: z.record(z.string(), z.unknown()).optional(),
});

export const diaryInputSchema = z.object({
  date: z.string().date(),
  content: z.string().trim().min(1).max(10000),
});

export const decisionInputSchema = z.object({
  type: z.enum(["accept", "reject"]),
  proposedChanges: z.record(z.string(), z.unknown()).optional(),
});

export const consultationInputSchema = z.object({
  message: z.string().trim().min(1).max(5000),
});

export const planFeedbackInputSchema = z.object({
  message: z.string().trim().min(1).max(3000),
});

export const planDayUpdateInputSchema = z.object({
  task: z.string().trim().min(1).max(2000),
});

export type GoalInput = z.infer<typeof goalInputSchema>;
export type DiaryInput = z.infer<typeof diaryInputSchema>;
export type DecisionInput = z.infer<typeof decisionInputSchema>;
export type ConsultationInput = z.infer<typeof consultationInputSchema>;
export type PlanFeedbackInput = z.infer<typeof planFeedbackInputSchema>;
export type PlanDayUpdateInput = z.infer<typeof planDayUpdateInputSchema>;

export type Goal = GoalInput & {
  goalId: string;
  guestSessionId: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanDay = {
  planDayId: string;
  planId: string;
  goalId: string;
  guestSessionId: string;
  dayIndex: number;
  planDate: string;
  tasks: string[];
  status: "planned" | "done" | "skipped";
  createdAt: string;
  updatedAt: string;
};

export type DiaryEntry = DiaryInput & {
  diaryId: string;
  goalId: string;
  guestSessionId: string;
  createdAt: string;
  updatedAt: string;
};

export type Feedback = {
  feedbackId: string;
  diaryId: string;
  guestSessionId: string;
  executionEstimate: number;
  summary: string;
  nextActions: string[];
  policyPassed: boolean;
  createdAt: string;
};

export type ReplanDecision = {
  decisionId: string;
  planId: string;
  guestSessionId: string;
  type: DecisionInput["type"];
  proposedChanges: Record<string, unknown>;
  changedFields: string[];
  createdAt: string;
};

export type ConversationMessage = {
  messageId: string;
  guestSessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type PlanConversationMessage = {
  messageId: string;
  planId: string;
  dayIndex: number;
  guestSessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export const createId = () => randomUUID();
export const now = () => new Date().toISOString();
