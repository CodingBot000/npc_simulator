export const emotionPrimaries = [
  "focused",
  "fearful",
  "angry",
  "guilty",
  "cold",
  "desperate",
] as const;

export const allowedActionTypes = [
  "accuse",
  "defend",
  "deflect",
  "appeal",
  "ally",
  "stall",
  "probe",
] as const;

export const playerActions = [
  "make_case",
  "expose",
  "appeal",
  "ally",
  "deflect",
  "stall",
  "confess",
] as const;

export type EmotionPrimary = (typeof emotionPrimaries)[number];
export type AllowedActionType = (typeof allowedActionTypes)[number];
export type PlayerAction = (typeof playerActions)[number];
export type InputMode = "free_text" | "action";
export type LlmProviderMode = "codex" | "openai";

export type NpcId = string;
export type CandidateId = string;
export type ResolutionType = "threshold" | "consensus" | "max_rounds" | null;

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

export interface NpcDecisionProfile {
  biasSummary: string;
  survivalRationale: string;
  redLines: string[];
  initialTargets: string[];
}

export interface PersistedNpcState {
  persona: NpcPersona;
  emotion: NpcEmotionState;
  relationship: RelationshipState;
  goals: NpcGoalState;
  decision: NpcDecisionProfile;
  currentLocation: string;
  statusLine: string;
}

export interface NpcState extends PersistedNpcState {
  memories: MemoryEntry[];
}

export interface EventLogEntry {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  tags: readonly string[];
  npcId: string;
  tone: "info" | "success" | "warning" | "danger";
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

export interface PressureImpact {
  blame: number;
  distrust: number;
  hostility: number;
  dispensability: number;
  utility: number;
  sympathy: number;
}

export interface PressureChange {
  candidateId: CandidateId;
  candidateLabel: string;
  totalPressureDelta: number;
  dimensionDelta: Partial<JudgementDimensions>;
  factors: string[];
  reasons: string[];
}

export interface RelationshipDelta {
  trust: number;
  affinity: number;
  tension: number;
}

export interface InspectorPayload {
  timestamp: string;
  npcId: string;
  targetNpcId: string | null;
  retrievedMemories: MemoryEntry[];
  emotion: NpcEmotionState;
  intent: IntentSummary;
  candidateActions: CandidateAction[];
  selectedAction: SelectedAction;
  selectedActionReason: string;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  leadingCandidateId: CandidateId | null;
  leadingCandidateLabel: string | null;
  round: number;
  resolution: ResolutionState;
}

export interface InteractionLogEntry {
  id: string;
  npcId: string;
  targetNpcId: string | null;
  playerId: string;
  inputMode: InputMode;
  playerText: string;
  playerAction: PlayerAction | null;
  replyText: string;
  timestamp: string;
  selectedAction: AllowedActionType;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  round: number;
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

export interface ScenarioPresentationSnapshot {
  appTitle: string;
  npcListTitle: string;
  npcListSubtitle: string;
  interactionTitle: string;
  interactionSubtitle: string;
  interactionPlaceholder: string;
  boardTitle: string;
  boardSubtitle: string;
}

export interface AvailableActionDefinition {
  id: PlayerAction;
  label: string;
  description: string;
  requiresTarget: boolean;
}

export interface WorldMeta {
  location: string;
  time: string;
  weather: string;
  mood: string;
}

export interface RoundState {
  currentRound: number;
  minRoundsBeforeResolution: number;
  maxRounds: number;
  resolutionUnlocked: boolean;
  rescueEtaLabel: string;
  facilityStatus: string;
}

export interface JudgementDimensions {
  blame: number;
  distrust: number;
  hostility: number;
  dispensability: number;
  utility: number;
  sympathy: number;
}

export interface JudgementState {
  evaluatorNpcId: string;
  candidateId: CandidateId;
  dimensions: JudgementDimensions;
  sacrificePreference: number;
}

export interface ConsensusBoardEntry {
  candidateId: CandidateId;
  candidateLabel: string;
  totalPressure: number;
  topVotes: number;
  trend: "up" | "down" | "flat";
  summary: string;
}

export interface ResolutionState {
  resolved: boolean;
  sacrificedNpcId: CandidateId | null;
  sacrificedLabel: string | null;
  resolutionType: ResolutionType;
  summary: string | null;
}

export interface WorldStateFile {
  scenarioId: string;
  world: WorldMeta;
  npcs: PersistedNpcState[];
  events: EventLogEntry[];
  lastInspector: InspectorPayload | null;
  round: RoundState;
  judgements: JudgementState[];
  resolution: ResolutionState;
}

export interface NpcMemoryFile {
  memories: Record<string, MemoryEntry[]>;
}

export interface InteractionLogFile {
  entries: InteractionLogEntry[];
}

export interface WorldSnapshot {
  scenarioId: string;
  presentation: ScenarioPresentationSnapshot;
  availableActions: AvailableActionDefinition[];
  world: WorldMeta;
  npcs: NpcState[];
  events: EventLogEntry[];
  conversations: Record<string, ChatMessage[]>;
  round: RoundState;
  consensusBoard: ConsensusBoardEntry[];
  lastInspector: InspectorPayload | null;
  runtime: RuntimeStatus;
  resolution: ResolutionState;
}

export interface InteractionRequestPayload {
  npcId: string;
  targetNpcId: string | null;
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
  targetNpc: PersistedNpcState | null;
  round: RoundState;
  consensusBoard: ConsensusBoardEntry[];
  recentEvents: EventLogEntry[];
  recentConversation: ChatMessage[];
  retrievedMemories: MemoryEntry[];
  normalizedInput: NormalizedInteractionInput;
}

export interface InteractionResponsePayload {
  reply: ReplyPayload;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  eventLogEntry: EventLogEntry;
  inspector: InspectorPayload;
  resolution: ResolutionState;
  world: WorldSnapshot;
}

export interface LlmProvider {
  mode: LlmProviderMode;
  getStatus(): Promise<RuntimeStatus>;
  generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult>;
}

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
