export const emotionPrimaries = [
  "calm",
  "curious",
  "guarded",
  "annoyed",
  "friendly",
] as const;

export const allowedActionTypes = [
  "answer",
  "ask_back",
  "refuse",
  "hint",
  "negotiate",
  "accept_request",
  "delay",
] as const;

export const playerActions = [
  "question",
  "persuade",
  "trade",
  "request",
  "empathize",
  "pressure",
] as const;

export type EmotionPrimary = (typeof emotionPrimaries)[number];
export type AllowedActionType = (typeof allowedActionTypes)[number];
export type PlayerAction = (typeof playerActions)[number];
export type InputMode = "free_text" | "action";
export type QuestStatus =
  | "locked"
  | "available"
  | "active"
  | "completed"
  | "failed";
export type LlmProviderMode = "codex" | "openai";

export type NpcId = string;

export interface NpcPersona {
  id: NpcId;
  name: string;
  role: string;
  tone: string;
  traits: string[];
  values: string[];
  dislikes: string[];
  secrets: string[];
}

export interface NpcEmotionState {
  primary: EmotionPrimary;
  intensity: number;
  reason: string;
}

export interface RelationshipState {
  playerTrust: number;
  playerAffinity: number;
  playerTension: number;
  npcOpinions: Record<string, number>;
}

export interface MemoryEntry {
  id: string;
  scope: "short" | "long";
  summary: string;
  tags: string[];
  importance: number;
  timestamp: string;
}

export interface NpcGoalState {
  currentGoal: string;
  currentNeed: string;
  opennessToPlayer: number;
}

export interface PersistedNpcState {
  persona: NpcPersona;
  emotion: NpcEmotionState;
  relationship: RelationshipState;
  goals: NpcGoalState;
  currentLocation: string;
  statusLine: string;
}

export interface NpcState extends PersistedNpcState {
  memories: MemoryEntry[];
}

export interface Quest {
  id: string;
  title: string;
  giverNpcId: string;
  status: QuestStatus;
  summary: string;
  requirements: string[];
  rewards: string[];
}

export interface EventLogEntry {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  tags: string[];
  npcId: string;
  tone: "info" | "success" | "warning";
}

export interface CandidateAction {
  type: AllowedActionType;
  label: string;
  reason: string;
}

export interface IntentSummary {
  summary: string;
  stance: string;
  leverage: string;
}

export interface SelectedAction {
  type: AllowedActionType;
  reason: string;
}

export interface ReplyPayload {
  text: string;
}

export interface LlmInteractionResult {
  reply: ReplyPayload;
  emotion: NpcEmotionState;
  intent: IntentSummary;
  candidateActions: CandidateAction[];
  selectedAction: SelectedAction;
}

export interface RippleEffect {
  npcId: string;
  trust: number;
  affinity: number;
  tension: number;
  note: string;
}

export interface RelationshipDelta {
  trust: number;
  affinity: number;
  tension: number;
  rippleEffects?: RippleEffect[];
}

export interface QuestUpdate {
  questId: string;
  title: string;
  from: QuestStatus;
  to: QuestStatus;
  note: string;
}

export interface InspectorPayload {
  timestamp: string;
  npcId: string;
  retrievedMemories: MemoryEntry[];
  emotion: NpcEmotionState;
  intent: IntentSummary;
  candidateActions: CandidateAction[];
  selectedAction: SelectedAction;
  selectedActionReason: string;
  relationshipDelta: RelationshipDelta;
  questUpdates: QuestUpdate[];
}

export interface InteractionLogEntry {
  id: string;
  npcId: string;
  playerId: string;
  inputMode: InputMode;
  playerText: string;
  playerAction: PlayerAction | null;
  replyText: string;
  timestamp: string;
  selectedAction: AllowedActionType;
  relationshipDelta: RelationshipDelta;
  questUpdates: QuestUpdate[];
}

export interface ChatMessage {
  id: string;
  npcId: string;
  speaker: "player" | "npc";
  text: string;
  timestamp: string;
  action: PlayerAction | AllowedActionType | null;
}

export interface RuntimeStatus {
  providerMode: LlmProviderMode;
  configured: boolean;
  label: string;
  detail: string;
}

export interface WorldMeta {
  location: string;
  time: string;
  weather: string;
  mood: string;
}

export interface WorldStateFile {
  world: WorldMeta;
  npcs: PersistedNpcState[];
  quests: Quest[];
  events: EventLogEntry[];
  lastInspector: InspectorPayload | null;
}

export interface NpcMemoryFile {
  memories: Record<string, MemoryEntry[]>;
}

export interface InteractionLogFile {
  entries: InteractionLogEntry[];
}

export interface WorldSnapshot {
  world: WorldMeta;
  npcs: NpcState[];
  quests: Quest[];
  events: EventLogEntry[];
  conversations: Record<string, ChatMessage[]>;
  lastInspector: InspectorPayload | null;
  runtime: RuntimeStatus;
}

export interface InteractionRequestPayload {
  npcId: string;
  inputMode: InputMode;
  text: string;
  action: PlayerAction | null;
  playerId: string;
}

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
  relatedQuests: Quest[];
  recentEvents: EventLogEntry[];
  recentConversation: ChatMessage[];
  retrievedMemories: MemoryEntry[];
  normalizedInput: NormalizedInteractionInput;
}

export interface InteractionResponsePayload {
  reply: ReplyPayload;
  relationshipDelta: RelationshipDelta;
  questUpdates: QuestUpdate[];
  eventLogEntry: EventLogEntry;
  inspector: InspectorPayload;
  world: WorldSnapshot;
}

export interface LlmProvider {
  mode: LlmProviderMode;
  getStatus(): Promise<RuntimeStatus>;
  generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult>;
}
