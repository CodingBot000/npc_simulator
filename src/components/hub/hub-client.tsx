"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EventLog } from "@/components/hub/event-log";
import { InteractionPanel } from "@/components/hub/interaction-panel";
import { NpcList } from "@/components/hub/npc-list";
import { PressureBoard } from "@/components/hub/pressure-board";
import { ResolutionModal } from "@/components/hub/resolution-modal";
import { StickySummaryHeader } from "@/components/hub/sticky-summary-header";
import { InspectorPanel } from "@/components/inspector/inspector-panel";
import { NpcCard } from "@/components/npc/npc-card";
import { Panel } from "@/components/ui/panel";
import { DEFAULT_PLAYER_ID } from "@/lib/constants";
import type {
  InteractionResponsePayload,
  PlayerAction,
  WorldSnapshot,
} from "@/lib/types";

function isApiError(
  payload: InteractionResponsePayload | WorldSnapshot | { message?: string },
): payload is { message?: string } {
  return "message" in payload;
}

interface HubClientProps {
  initialWorld: WorldSnapshot;
}

export function HubClient({ initialWorld }: HubClientProps) {
  const [world, setWorld] = useState(initialWorld);
  const [selectedNpcId, setSelectedNpcId] = useState(
    initialWorld.npcs[0]?.persona.id ?? "",
  );
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    initialWorld.npcs.find((npc) => npc.persona.id !== initialWorld.npcs[0]?.persona.id)?.persona.id ??
      null,
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [lastOutcome, setLastOutcome] =
    useState<InteractionResponsePayload | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  const [showStickySummary, setShowStickySummary] = useState(false);
  const [stickyPinned, setStickyPinned] = useState(false);
  const [gameOverOpen, setGameOverOpen] = useState(
    initialWorld.resolution.resolved,
  );
  const summarySectionRef = useRef<HTMLDivElement | null>(null);

  const selectedNpc =
    world.npcs.find((npc) => npc.persona.id === selectedNpcId) ?? world.npcs[0];
  const conversation = world.conversations[selectedNpc.persona.id] ?? [];
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
  const stickyConsensusEntries = world.consensusBoard
    .filter((entry) => entry.candidateId !== DEFAULT_PLAYER_ID)
    .slice(0, world.npcs.length);

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
    inputMode: "free_text" | "action";
    action: PlayerAction | null;
    text: string;
  }) {
    setBusy(true);
    setError(null);
    setDraftWarning(null);

    try {
      const response = await fetch("/api/interact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          npcId: selectedNpc.persona.id,
          targetNpcId: selectedTargetId,
          inputMode: payload.inputMode,
          text: payload.text,
          action: payload.action,
          playerId: DEFAULT_PLAYER_ID,
        }),
      });

      const data = (await response.json()) as
        | InteractionResponsePayload
        | { message?: string };

      if (!response.ok) {
        throw new Error(
          isApiError(data) ? data.message || "상호작용 처리에 실패했습니다." : "상호작용 처리에 실패했습니다.",
        );
      }

      setWorld((data as InteractionResponsePayload).world);
      setLastOutcome(data as InteractionResponsePayload);
      setDraft("");
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "상호작용 처리에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetWorld() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/reset", { method: "POST" });
      const data = (await response.json()) as WorldSnapshot | { message?: string };

      if (!response.ok) {
        throw new Error(
          isApiError(data) ? data.message || "상태 초기화에 실패했습니다." : "상태 초기화에 실패했습니다.",
        );
      }

      setWorld(data as WorldSnapshot);
      setSelectedNpcId((data as WorldSnapshot).npcs[0]?.persona.id ?? "");
      setSelectedTargetId(
        (data as WorldSnapshot).npcs[1]?.persona.id ??
          (data as WorldSnapshot).npcs[0]?.persona.id ??
          null,
      );
      setLastOutcome(null);
      setDraft("");
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

  function handleAction(action: PlayerAction) {
    const actionDefinition = world.availableActions.find((item) => item.id === action);

    if (actionDefinition?.requiresTarget && !selectedTargetId) {
      setDraftWarning("이 행동은 먼저 논의 대상을 골라야 합니다.");
      return;
    }

    void sendInteraction({
      inputMode: "action",
      action,
      text: draft,
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
          <Panel
            eyebrow="Crisis Chamber"
            title={world.presentation.appTitle}
            subtitle={`${world.world.location} · ${world.world.time} · ${world.world.mood}`}
            trailing={
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/review"
                  className="rounded-full border border-[var(--panel-border)] bg-white/60 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-[var(--accent)]"
                >
                  데이터 검수
                </Link>
                <button
                  type="button"
                  onClick={() => setInspectorOpen((current) => !current)}
                  className="rounded-full border border-[var(--panel-border)] bg-white/60 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-[var(--teal)]"
                >
                  {inspectorOpen ? "감독자 닫기" : "감독자 열기"}
                </button>
                <button
                  type="button"
                  onClick={resetWorld}
                  disabled={busy}
                  className="rounded-full bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  reset
                </button>
              </div>
            }
          >
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-[var(--panel-strong)] px-3 py-1 font-semibold text-[var(--accent)]">
                {world.runtime.label}
              </span>
              <span className="text-[var(--ink-muted)]">{world.runtime.detail}</span>
              <span className="rounded-full bg-white/40 px-3 py-1 font-semibold text-[var(--teal)]">
                Episode {world.episodeId.slice(0, 8)}
              </span>
              <span className="text-[var(--ink-muted)]">
                {world.datasetExportedAt ? "dataset exported" : "dataset pending"}
              </span>
            </div>
            {error ? (
              <p className="mt-3 rounded-2xl bg-rose-100 px-4 py-3 text-sm text-[var(--danger)]">
                {error}
              </p>
            ) : null}
          </Panel>

          <div
            ref={summarySectionRef}
            className="grid gap-4 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start"
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
            onSelectNpc={setSelectedNpcId}
            onTogglePinned={() => setStickyPinned((current) => !current)}
          />

          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid gap-4 grid-cols-[minmax(0,6.5fr)_minmax(360px,3.5fr)] items-start">
              <div className="min-w-0">
                <InteractionPanel
                  npc={selectedNpc}
                  conversation={conversation}
                  draft={draft}
                  busy={busy}
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

            <div
              className={`grid gap-4 items-stretch ${
                inspectorOpen
                ? "grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]"
                : "grid-cols-1"
            }`}
          >
            <div className="min-h-[420px] min-w-0">
              <EventLog events={world.events} />
            </div>

            {inspectorOpen ? (
              <div className="min-h-[420px] min-w-0">
                <InspectorPanel
                  inspector={world.lastInspector}
                  npc={selectedNpc}
                  open={inspectorOpen}
                />
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </main>
    </>
  );
}
