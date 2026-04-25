import { useEffect, useRef, useState } from "react";
import { EventLog } from "@/components/hub/event-log";
import { InteractionPanel } from "@/components/hub/interaction-panel";
import { MissionBriefCard } from "@/components/hub/mission-brief-card";
import { NpcList } from "@/components/hub/npc-list";
import { PressureBoard } from "@/components/hub/pressure-board";
import { ResolutionModal } from "@/components/hub/resolution-modal";
import { StickySummaryHeader } from "@/components/hub/sticky-summary-header";
import { InspectorPanel } from "@/components/inspector/inspector-panel";
import { NpcCard } from "@/components/npc/npc-card";
import { Panel } from "@/components/ui/panel";
import { apiGetWorld, apiInteract, apiResetWorld } from "@/lib/api-client";
import { DEFAULT_PLAYER_ID, DEFAULT_PLAYER_LABEL } from "@/lib/constants";
import type {
  ChatMessage,
  InteractionRequestPayload,
  InteractionResponsePayload,
  PlayerAction,
  WorldSnapshot,
} from "@/lib/types";
import {
  formatPlayerConversationText,
  hasScenarioScoring,
  mergeWorldSnapshotScoring,
  nowIso,
} from "@/lib/utils";

interface HubClientProps {
  initialWorld: WorldSnapshot;
}

interface PendingConversationTurn {
  npcId: string;
  playerMessage: ChatMessage;
  startedAtMs: number;
}

function findLatestNpcReplyMessage(
  conversation: ChatMessage[],
  replyText: string,
  previousMessageIds: Set<string>,
) {
  return (
    [...conversation]
      .reverse()
      .find(
        (message) =>
          message.speaker === "npc" &&
          message.text === replyText &&
          !previousMessageIds.has(message.id),
      ) ??
    [...conversation]
      .reverse()
      .find((message) => message.speaker === "npc" && !previousMessageIds.has(message.id)) ??
    null
  );
}

export function HubClient({ initialWorld }: HubClientProps) {
  const [world, setWorld] = useState(initialWorld);
  const [selectedNpcId, setSelectedNpcId] = useState(
    initialWorld.npcs[0]?.persona.id ?? "",
  );
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    initialWorld.npcs.find(
      (npc) => npc.persona.id !== initialWorld.npcs[0]?.persona.id,
    )?.persona.id ?? null,
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [interactionBusy, setInteractionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [lastOutcome, setLastOutcome] =
    useState<InteractionResponsePayload | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  const [pendingConversationTurn, setPendingConversationTurn] =
    useState<PendingConversationTurn | null>(null);
  const [replyElapsedByMessageId, setReplyElapsedByMessageId] = useState<
    Record<string, number>
  >({});
  const [showStickySummary, setShowStickySummary] = useState(false);
  const [stickyPinned, setStickyPinned] = useState(false);
  const [gameOverOpen, setGameOverOpen] = useState(
    initialWorld.resolution.resolved,
  );
  const scoringRecoveryAttemptedRef = useRef(hasScenarioScoring(initialWorld.scoring));
  const summarySectionRef = useRef<HTMLDivElement | null>(null);
  const allowDevTools =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("dev") === "1";

  const selectedNpc =
    world.npcs.find((npc) => npc.persona.id === selectedNpcId) ?? world.npcs[0];
  const baseConversation = world.conversations[selectedNpc.persona.id] ?? [];
  const riskByNpcId = Object.fromEntries(
    world.consensusBoard.map((entry) => [entry.candidateId, entry.totalPressure]),
  );
  const targetOptions = world.consensusBoard
    .filter(
      (entry) =>
        entry.candidateId !== selectedNpc.persona.id &&
        entry.candidateId !== DEFAULT_PLAYER_ID,
    )
    .map((entry) => ({
      id: entry.candidateId,
      label: entry.candidateLabel,
    }));
  const pendingConversationForSelectedNpc =
    pendingConversationTurn?.npcId === selectedNpc.persona.id
      ? [pendingConversationTurn.playerMessage]
      : [];
  const conversation = [
    ...baseConversation,
    ...pendingConversationForSelectedNpc,
  ];
  const waitingForSelectedNpcReply =
    interactionBusy && pendingConversationTurn?.npcId === selectedNpc.persona.id;
  const stickyConsensusEntries = world.consensusBoard.slice(0, world.npcs.length + 1);

  useEffect(() => {
    if (selectedTargetId === selectedNpc.persona.id) {
      setSelectedTargetId(targetOptions[0]?.id ?? null);
    }
  }, [selectedNpc.persona.id, selectedTargetId, targetOptions]);

  useEffect(() => {
    if (world.resolution.resolved) {
      setGameOverOpen(true);
    }
  }, [world.resolution.resolved]);

  useEffect(() => {
    if (hasScenarioScoring(world.scoring) || scoringRecoveryAttemptedRef.current) {
      return;
    }

    scoringRecoveryAttemptedRef.current = true;
    const controller = new AbortController();

    async function recoverScoring() {
      try {
        const payload = await apiGetWorld({
          cache: "no-store",
          signal: controller.signal,
        });

        setWorld((current) =>
          mergeWorldSnapshotScoring(payload, current.scoring),
        );
      } catch {
        // Keep the generic fallback text when recovery fails.
      }
    }

    void recoverScoring();

    return () => controller.abort();
  }, [world.scoring]);

  useEffect(() => {
    const target = summarySectionRef.current;

    if (!target) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowStickySummary(!entry.isIntersecting);
      },
      {
        threshold: 0,
        rootMargin: "-150px 0px 0px 0px",
      },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, []);

  async function sendInteraction(payload: {
    inputMode: "free_text" | "action" | "combined";
    action: PlayerAction | null;
    text: string;
  }) {
    const timestamp = nowIso();
    const requestStartedAtMs = Date.now();
    const previousMessageIds = new Set(baseConversation.map((message) => message.id));
    const pendingTargetLabel =
      selectedTargetId
        ? targetOptions.find((option) => option.id === selectedTargetId)?.label ??
          DEFAULT_PLAYER_LABEL
        : null;
    setBusy(true);
    setInteractionBusy(true);
    setError(null);
    setDraftWarning(null);
    setPendingConversationTurn({
      npcId: selectedNpc.persona.id,
      startedAtMs: requestStartedAtMs,
      playerMessage: {
        id: `pending-${crypto.randomUUID()}`,
        npcId: selectedNpc.persona.id,
        speaker: "player",
        text: formatPlayerConversationText({
          text: payload.text,
          action: payload.action,
          targetLabel: pendingTargetLabel,
        }),
        timestamp,
        action: payload.action,
      },
    });

    try {
      const requestBody: InteractionRequestPayload = {
        npcId: selectedNpc.persona.id,
        targetNpcId: selectedTargetId,
        inputMode: payload.inputMode,
        text: payload.text,
        action: payload.action,
        playerId: DEFAULT_PLAYER_ID,
      };
      const responsePayload = await apiInteract(requestBody);
      const updatedConversation =
        responsePayload.world.conversations[selectedNpc.persona.id] ?? [];
      const replyMessage = findLatestNpcReplyMessage(
        updatedConversation,
        responsePayload.reply.text,
        previousMessageIds,
      );

      if (replyMessage) {
        setReplyElapsedByMessageId((current) => ({
          ...current,
          [replyMessage.id]: Date.now() - requestStartedAtMs,
        }));
      }

      setWorld((current) =>
        mergeWorldSnapshotScoring(
          responsePayload.world,
          current.scoring,
        ),
      );
      setLastOutcome(responsePayload);
      setPendingConversationTurn(null);
      setDraft("");
    } catch (fetchError) {
      setPendingConversationTurn(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "상호작용 처리에 실패했습니다.",
      );
    } finally {
      setInteractionBusy(false);
      setBusy(false);
    }
  }

  async function resetWorld() {
    setBusy(true);
    setError(null);

    try {
      const data = await apiResetWorld();

      setWorld((current) =>
        mergeWorldSnapshotScoring(data, current.scoring),
      );
      setSelectedNpcId(data.npcs[0]?.persona.id ?? "");
      setSelectedTargetId(
        data.npcs[1]?.persona.id ?? data.npcs[0]?.persona.id ?? null,
      );
      setPendingConversationTurn(null);
      setReplyElapsedByMessageId({});
      setLastOutcome(null);
      setDraft("");
      setDraftWarning(null);
      setGameOverOpen(false);
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "상태 초기화에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit() {
    if (!draft.trim()) {
      setDraftWarning("발언 내용을 입력하세요");
      return;
    }

    void sendInteraction({
      inputMode: "free_text",
      action: null,
      text: draft,
    });
  }

  function handleAction(
    action: PlayerAction,
    inputMode: "action" | "combined",
  ) {
    const actionDefinition = world.availableActions.find((item) => item.id === action);

    if (actionDefinition?.requiresTarget && !selectedTargetId) {
      setDraftWarning("이 행동은 먼저 흔들 사람을 골라야 합니다.");
      return;
    }

    void sendInteraction({
      inputMode,
      action,
      text: inputMode === "combined" ? draft : "",
    });
  }

  return (
    <>
      <ResolutionModal
        open={gameOverOpen}
        busy={busy}
        world={world}
        onClose={() => setGameOverOpen(false)}
        onRestart={() => {
          void resetWorld();
        }}
      />

      <main className="min-h-screen overflow-x-auto px-6 py-6">
        <div className="mx-auto flex min-w-[1280px] w-full max-w-[1540px] flex-col gap-4">
          <MissionBriefCard
            busy={busy}
            round={world.round}
            scoring={world.scoring}
            world={world.world}
            onRestart={() => {
              void resetWorld();
            }}
          />

          {error ? (
            <p className="rounded-2xl bg-rose-100 px-4 py-3 text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <div
            ref={summarySectionRef}
            className="grid gap-4 grid-cols-[minmax(0,6.5fr)_minmax(0,3.5fr)] items-start"
          >
            <PressureBoard
              entries={world.consensusBoard}
              title={world.presentation.boardTitle}
              subtitle={world.presentation.boardSubtitle}
            />

            <NpcList
              title={world.presentation.npcListTitle}
              npcs={world.npcs}
              selectedNpcId={selectedNpc.persona.id}
              subtitle={world.presentation.npcListSubtitle}
              riskByNpcId={riskByNpcId}
              disabled={busy}
              onSelect={setSelectedNpcId}
            />
          </div>

          <StickySummaryHeader
            visible={showStickySummary || stickyPinned}
            pinned={stickyPinned}
            consensusEntries={stickyConsensusEntries}
            npcs={world.npcs}
            selectedNpcId={selectedNpc.persona.id}
            riskByNpcId={riskByNpcId}
            disabled={busy}
            onSelectNpc={setSelectedNpcId}
            onTogglePinned={() => setStickyPinned((current) => !current)}
          />

          <div className="grid gap-4 grid-cols-[minmax(0,6.5fr)_minmax(360px,3.5fr)] items-start">
            <div className="min-w-0">
            <InteractionPanel
                npc={selectedNpc}
                conversation={conversation}
                draft={draft}
                busy={busy}
                waitingForReply={waitingForSelectedNpcReply}
                pendingReplyStartedAtMs={
                  pendingConversationTurn?.npcId === selectedNpc.persona.id
                    ? pendingConversationTurn.startedAtMs
                    : null
                }
                replyElapsedByMessageId={replyElapsedByMessageId}
                subtitle={world.presentation.interactionSubtitle}
                placeholder={world.presentation.interactionPlaceholder}
                availableActions={world.availableActions}
                targetOptions={targetOptions}
                selectedTargetId={selectedTargetId}
                round={world.round}
                resolution={world.resolution}
                lastOutcome={lastOutcome}
                draftWarning={draftWarning}
                onDraftChange={(value) => {
                  setDraft(value);
                  if (value.trim()) {
                    setDraftWarning(null);
                  }
                }}
                onTargetChange={(value) => {
                  setSelectedTargetId(value);
                  setDraftWarning(null);
                }}
                onSubmit={handleSubmit}
              onAction={handleAction}
            />
            </div>

            <div className="min-w-0">
              <NpcCard key={selectedNpc.persona.id} npc={selectedNpc} />
            </div>
          </div>

          <div className="min-w-0">
            <EventLog events={world.events} />
          </div>

          {allowDevTools ? (
            <Panel
              eyebrow="개발자"
              title="개발자 도구"
              subtitle="기본 사용자 동선에서는 숨겨진 내부 정보를 여기서만 펼칠 수 있다."
              trailing={
                <button
                  type="button"
                  onClick={() => setInspectorOpen((current) => !current)}
                  className="rounded-full border border-[var(--panel-border)] bg-white/10 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white/18"
                >
                  {inspectorOpen ? "내부 정보 닫기" : "내부 정보 열기"}
                </button>
              }
            >
              {inspectorOpen ? (
                <InspectorPanel
                  inspector={world.lastInspector}
                  npc={selectedNpc}
                  open={inspectorOpen}
                />
              ) : (
                <p className="text-sm leading-6 text-[var(--ink-muted)]">
                  `?dev=1`로 들어왔을 때만 보이는 섹션이다. 플레이어 화면에서는 기본으로 감춘다.
                </p>
              )}
            </Panel>
          ) : null}
        </div>
      </main>
    </>
  );
}
