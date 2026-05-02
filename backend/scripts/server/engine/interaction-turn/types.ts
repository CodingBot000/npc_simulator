import type {
  ConsensusBoardEntry,
  EventLogEntry,
  NpcState,
  RetrievedKnowledgeEvidence,
  RetrievedMemoryEntry,
} from "@backend-contracts/api";
import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@backend-persistence";
import type { PersistedNpcState } from "@backend-domain";
import type {
  GenerateInteractionInput,
  NormalizedInteractionInput,
} from "@backend-provider";
import type { InteractionContract } from "@server/engine/interaction-contract";

export interface InteractionTurnContext {
  worldState: WorldStateFile;
  memoryFile: NpcMemoryFile;
  interactionLog: InteractionLogFile;
  npc: NpcState;
  targetNpc: PersistedNpcState | null;
  normalizedInput: NormalizedInteractionInput;
  recentConversation: GenerateInteractionInput["recentConversation"];
  consensusBoardBefore: ConsensusBoardEntry[];
  leaderBefore: ConsensusBoardEntry | null;
  recentEvents: EventLogEntry[];
  retrievedMemories: RetrievedMemoryEntry[];
  retrievedKnowledge: RetrievedKnowledgeEvidence[];
  roundBefore: number;
  initialTargetLabel: string | null;
  promptContextSummary: string;
  generationInput: GenerateInteractionInput;
  interactionContract: InteractionContract;
}
