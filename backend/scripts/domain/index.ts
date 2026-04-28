import type {
  NpcState,
  RetrievedKnowledgeEvidence,
} from "@backend-contracts/api";
import type { JudgementDimensions } from "@sim-shared/types";

export type KnowledgeEvidence = Omit<
  RetrievedKnowledgeEvidence,
  "score" | "scoreBreakdown" | "matchReasons"
>;

export type PersistedNpcState = Omit<NpcState, "memories">;
export type PressureImpact = JudgementDimensions;

export type QuestStatus =
  | "locked"
  | "available"
  | "active"
  | "completed"
  | "failed";

export interface Quest {
  id: string;
  title: string;
  giverNpcId: string;
  status: QuestStatus;
  summary: string;
  requirements: string[];
  rewards: string[];
}

export interface QuestUpdate {
  questId: string;
  title: string;
  from: QuestStatus;
  to: QuestStatus;
  note: string;
}
