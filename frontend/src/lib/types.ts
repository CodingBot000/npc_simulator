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

export const impactTags = [
  "player_distrust_up",
  "player_distrust_down",
  "player_blame_up",
  "player_blame_down",
  "player_sympathy_up",
  "player_sympathy_down",
  "target_blame_up",
  "target_blame_high_up",
  "target_blame_down",
  "target_distrust_up",
  "target_distrust_down",
  "target_hostility_up",
  "target_hostility_down",
  "target_sympathy_up",
  "target_sympathy_down",
  "target_utility_down",
  "target_utility_up",
  "target_dispensability_up",
  "target_dispensability_down",
  "room_pressure_shift",
  "no_major_shift",
] as const;

export type EmotionPrimary = (typeof emotionPrimaries)[number];
export type AllowedActionType = (typeof allowedActionTypes)[number];
export type PlayerAction = (typeof playerActions)[number];
export type ImpactTag = (typeof impactTags)[number];
export type InputMode = "free_text" | "action";
export type LlmProviderMode = "codex" | "openai" | "deterministic";

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

export interface RetrievalScoreBreakdown {
  tokenOverlap: number;
  tagOverlap: number;
  recency: number;
  importance: number;
  priority: number;
  npcMatch: number;
  targetMatch: number;
  eventMatch: number;
  total: number;
}

export interface RetrievedMemoryEntry extends MemoryEntry {
  score: number;
  scoreBreakdown: RetrievalScoreBreakdown;
  matchReasons: string[];
}

export type KnowledgeEvidenceType =
  | "world_fact"
  | "incident_log"
  | "private_secret"
  | "role_record";

export interface KnowledgeEvidence {
  id: string;
  sourceType: KnowledgeEvidenceType;
  title: string;
  summary: string;
  tags: string[];
  relatedNpcIds: string[];
  priority: number;
  visibility: "public" | "private" | "conditional";
  roundIntroduced: number | null;
}

export interface RetrievedKnowledgeEvidence extends KnowledgeEvidence {
  score: number;
  scoreBreakdown: RetrievalScoreBreakdown;
  matchReasons: string[];
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

export interface StructuredImpactInference {
  impactTags: ImpactTag[];
  targetNpcId: string | null;
  confidence: number;
  rationale: string;
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
  structuredImpact: StructuredImpactInference;
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
  episodeId: string;
  npcId: string;
  targetNpcId: string | null;
  retrievedMemories: RetrievedMemoryEntry[];
  retrievedKnowledge: RetrievedKnowledgeEvidence[];
  emotion: NpcEmotionState;
  intent: IntentSummary;
  candidateActions: CandidateAction[];
  selectedAction: SelectedAction;
  selectedActionReason: string;
  structuredImpact: StructuredImpactInference;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  leaderBefore: ConsensusBoardEntry | null;
  leaderAfter: ConsensusBoardEntry | null;
  leadingCandidateId: CandidateId | null;
  leadingCandidateLabel: string | null;
  round: number;
  resolution: ResolutionState;
  llmPromptContextSummary: string;
  datasetExportedAt: string | null;
  exportPaths: EpisodeExportPaths;
}

export interface InteractionLogEntry {
  id: string;
  npcId: string;
  targetNpcId: string | null;
  playerId: string;
  inputMode: InputMode;
  roundBefore?: number;
  roundAfter?: number;
  playerText: string;
  rawPlayerText?: string;
  normalizedInputSummary?: string;
  playerAction: PlayerAction | null;
  replyText: string;
  timestamp: string;
  retrievedMemories?: RetrievedMemoryEntry[];
  retrievedKnowledge?: RetrievedKnowledgeEvidence[];
  llmPromptContextSummary?: string;
  emotion?: NpcEmotionState;
  intent?: IntentSummary;
  candidateActions?: CandidateAction[];
  selectedAction: AllowedActionType;
  selectedActionReason?: string;
  structuredImpact?: StructuredImpactInference;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  leaderBefore?: ConsensusBoardEntry | null;
  leaderAfter?: ConsensusBoardEntry | null;
  resolutionAfter?: ResolutionState;
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

export interface EpisodeExportPaths {
  richTrace: string | null;
  sft: string | null;
  review: string | null;
}

export interface WorldStateFile {
  scenarioId: string;
  episodeId: string;
  startedAt: string;
  endedAt: string | null;
  datasetExportedAt: string | null;
  exportPaths: EpisodeExportPaths;
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
  episodeId: string;
  startedAt: string;
  endedAt: string | null;
  datasetExportedAt: string | null;
  exportPaths: EpisodeExportPaths;
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
  retrievedMemories: RetrievedMemoryEntry[];
  retrievedKnowledge: RetrievedKnowledgeEvidence[];
  normalizedInput: NormalizedInteractionInput;
  promptContextSummary: string;
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
