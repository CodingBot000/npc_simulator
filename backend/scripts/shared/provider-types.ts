import type {
  ChatMessage,
  EventLogEntry,
  InteractionRequestPayload,
  LlmInteractionResult,
  LlmProviderMode,
  NpcState,
  RetrievedKnowledgeEvidence,
  RetrievedMemoryEntry,
  RoundState,
  WorldMeta,
} from "./api-contract-types";
import type { PersistedNpcState } from "./domain-types";
import type { ConsensusBoardEntry, PlayerAction } from "@sim-shared/types";

export interface NormalizedInteractionInput {
  text: string;
  action: PlayerAction | null;
  actionLabel: string | null;
  promptSummary: string;
}

export interface GenerateInteractionInput {
  request: InteractionRequestPayload;
  world: WorldMeta;
  npc: NpcState;
  targetNpc: PersistedNpcState | null;
  round: RoundState;
  consensusBoard: ConsensusBoardEntry[];
  recentEvents: EventLogEntry[];
  recentConversation: ChatMessage[];
  retrievedMemories: RetrievedMemoryEntry[];
  retrievedKnowledge: RetrievedKnowledgeEvidence[];
  normalizedInput: NormalizedInteractionInput;
  promptContextSummary: string;
}

export interface LlmProvider {
  mode: LlmProviderMode;
  generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult>;
}
