export type EmotionPrimary =
  | "focused"
  | "fearful"
  | "angry"
  | "guilty"
  | "cold"
  | "desperate";

export type AllowedActionType =
  | "accuse"
  | "defend"
  | "deflect"
  | "appeal"
  | "ally"
  | "stall"
  | "probe";

export type PlayerAction =
  | "make_case"
  | "expose"
  | "appeal"
  | "ally"
  | "deflect"
  | "stall"
  | "confess";

export type AutonomyMoveType =
  | "pile_on"
  | "shield"
  | "redirect"
  | "freeze";

export type ImpactTag =
  | "player_distrust_up"
  | "player_distrust_down"
  | "player_blame_up"
  | "player_blame_down"
  | "player_sympathy_up"
  | "player_sympathy_down"
  | "target_blame_up"
  | "target_blame_high_up"
  | "target_blame_down"
  | "target_distrust_up"
  | "target_distrust_down"
  | "target_hostility_up"
  | "target_hostility_down"
  | "target_sympathy_up"
  | "target_sympathy_down"
  | "target_utility_down"
  | "target_utility_up"
  | "target_dispensability_up"
  | "target_dispensability_down"
  | "room_pressure_shift"
  | "no_major_shift";

export type InputMode = "free_text" | "action" | "combined";
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
  tags: string[];
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
  rewriteSource?: string | null;
}

export interface LlmInteractionResult {
  reply: ReplyPayload;
  emotion: NpcEmotionState;
  intent: IntentSummary;
  candidateActions: CandidateAction[];
  selectedAction: SelectedAction;
  structuredImpact: StructuredImpactInference;
}

export type RuntimeArtifactKind =
  | "mlx_adapter"
  | "mlx_fused_model"
  | "legacy_mlx_adapter";

export type ShadowComparisonStatus = "parsed" | "invalid_json" | "error";

export interface ShadowComparisonPayload {
  label: string;
  mode: "local_mlx";
  status: ShadowComparisonStatus;
  durationMs: number | null;
  sourceRef: string | null;
  artifactKind: RuntimeArtifactKind | null;
  error: string | null;
  rawOutput: string | null;
  result: LlmInteractionResult | null;
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

export interface AutonomyRngSample {
  label: string;
  drawIndex: number;
  value: number;
}

export interface AutonomyOpinionDelta {
  npcId: string;
  npcLabel: string;
  delta: number;
}

export interface AutonomyJudgementChange {
  candidateId: CandidateId;
  candidateLabel: string;
  dimensionDelta: Partial<JudgementDimensions>;
}

export interface AutonomyStepResult {
  actorNpcId: string;
  actorLabel: string;
  moveType: AutonomyMoveType;
  targetNpcId: string | null;
  targetLabel: string | null;
  secondaryTargetNpcId: string | null;
  secondaryTargetLabel: string | null;
  rationale: string;
  summary: string;
  tone: EventLogEntry["tone"];
  opinionDeltas: AutonomyOpinionDelta[];
  judgementChanges: AutonomyJudgementChange[];
  rngSamples: AutonomyRngSample[];
}

export interface AutonomyPhaseResult {
  executed: boolean;
  round: number;
  drawCountBefore: number;
  drawCountAfter: number;
  leaderBefore: ConsensusBoardEntry | null;
  leaderAfter: ConsensusBoardEntry | null;
  boardTopBefore: ConsensusBoardEntry[];
  boardTopAfter: ConsensusBoardEntry[];
  rngSamples: AutonomyRngSample[];
  steps: AutonomyStepResult[];
}

export interface InspectorPayload {
  timestamp: string;
  episodeId: string;
  npcId: string;
  targetNpcId: string | null;
  replyText: string;
  fallbackUsed?: boolean;
  replyRewriteSource?: string | null;
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
  shadowComparison: ShadowComparisonPayload | null;
  autonomyPhase?: AutonomyPhaseResult | null;
}

export interface ChatMessage {
  id: string;
  npcId: string;
  speaker: "player" | "npc";
  text: string;
  timestamp: string;
  action: PlayerAction | AllowedActionType | null;
  fallbackUsed?: boolean;
  replyRewriteSource?: string | null;
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

export interface ScenarioScoringSnapshot {
  minRoundsBeforeResolution: number;
  maxRounds: number;
  instantConsensusVotes: number;
  leadGapThreshold: number;
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

export interface WorldSnapshot {
  scenarioId: string;
  episodeId: string;
  startedAt: string;
  endedAt: string | null;
  datasetExportedAt: string | null;
  exportPaths: EpisodeExportPaths;
  presentation: ScenarioPresentationSnapshot;
  scoring?: ScenarioScoringSnapshot | null;
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

export interface InteractionResponsePayload {
  reply: ReplyPayload;
  relationshipDelta: RelationshipDelta;
  pressureChanges: PressureChange[];
  eventLogEntry: EventLogEntry;
  inspector: InspectorPayload;
  resolution: ResolutionState;
  world: WorldSnapshot;
}
