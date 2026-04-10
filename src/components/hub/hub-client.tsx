"use client";

import { useEffect, useState } from "react";
import { EventLog } from "@/components/hub/event-log";
import { InteractionPanel } from "@/components/hub/interaction-panel";
import { NpcList } from "@/components/hub/npc-list";
import { PressureBoard } from "@/components/hub/pressure-board";
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

  useEffect(() => {
    if (selectedTargetId === selectedNpc.persona.id) {
      setSelectedTargetId(targetOptions[0]?.id ?? null);
    }
  }, [selectedNpc.persona.id, selectedTargetId, targetOptions]);

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
    <main className="min-h-screen px-4 py-5 md:px-6 md:py-6">
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-4">
        <Panel
          eyebrow="Crisis Chamber"
          title={world.presentation.appTitle}
          subtitle={`${world.world.location} · ${world.world.time} · ${world.world.mood}`}
          trailing={
            <div className="flex flex-wrap gap-2">
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
          </div>
          {error ? (
            <p className="mt-3 rounded-2xl bg-rose-100 px-4 py-3 text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}
        </Panel>

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_350px]">
          <NpcList
            title={world.presentation.npcListTitle}
            npcs={world.npcs}
            selectedNpcId={selectedNpc.persona.id}
            subtitle={world.presentation.npcListSubtitle}
            riskByNpcId={riskByNpcId}
            onSelect={setSelectedNpcId}
          />

          <div className="flex flex-col gap-4">
            <PressureBoard
              entries={world.consensusBoard}
              title={world.presentation.boardTitle}
              subtitle={world.presentation.boardSubtitle}
            />
            <NpcCard npc={selectedNpc} />
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
            <EventLog events={world.events} />
          </div>

          <InspectorPanel
            inspector={world.lastInspector}
            npc={selectedNpc}
            open={inspectorOpen}
          />
        </div>
      </div>
    </main>
  );
}
