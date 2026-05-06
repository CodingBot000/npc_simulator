import type {
  AvailableActionDefinition,
  ChatMessage,
  InteractionTraceEntry,
  InteractionResponsePayload,
  NpcState,
  PlayerAction,
  ResolutionState,
  RoundState,
} from "@/lib/types";

export interface InteractionPanelProps {
  npc: NpcState;
  conversation: ConversationMessage[];
  draft: string;
  busy: boolean;
  waitingForReply: boolean;
  pendingReplyStartedAtMs: number | null;
  replyElapsedByMessageId: Record<string, number>;
  subtitle: string;
  placeholder: string;
  availableActions: AvailableActionDefinition[];
  targetOptions: Array<{ id: string; label: string }>;
  selectedTargetId: string | null;
  round: RoundState;
  resolution: ResolutionState;
  lastOutcome: InteractionResponsePayload | null;
  conversationDebugEnabled: boolean;
  draftWarning: string | null;
  onDraftChange: (value: string) => void;
  onTargetChange: (value: string | null) => void;
  onSubmit: () => void;
  onAction: (action: PlayerAction, inputMode: "action" | "combined") => void;
  onToggleConversationDebug: () => void;
}

export type PlayInputMode = "intent_only" | "free_text" | "combined";

export type ConversationMessage = ChatMessage & {
  deliveryStatus?: "failed";
};

export type FailureDebugEntry = NonNullable<ChatMessage["failureDebug"]>[number];

export type InteractionTraceTurn = {
  npcMessage: ConversationMessage;
  playerMessage: ConversationMessage | null;
  traceEntries: InteractionTraceEntry[];
  frontendElapsedMs: number | null;
};
