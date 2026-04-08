"use client";

import { useState } from "react";
import {
  EventLog,
} from "@/components/hub/event-log";
import {
  InteractionInputCase,
  InteractionPanel,
} from "@/components/hub/interaction-panel";
import { NpcList } from "@/components/hub/npc-list";
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
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [lastOutcome, setLastOutcome] =
    useState<InteractionResponsePayload | null>(null);
  const [interactionCase, setInteractionCase] =
    useState<InteractionInputCase>("free_text_only");
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  const selectedNpc =
    world.npcs.find((npc) => npc.persona.id === selectedNpcId) ?? world.npcs[0];
  const relatedQuests = world.quests.filter(
    (quest) =>
      quest.giverNpcId === selectedNpc.persona.id ||
      quest.summary.includes(selectedNpc.persona.name),
  );
  const conversation = world.conversations[selectedNpc.persona.id] ?? [];

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

  function handleDraftChange(value: string) {
    setDraft(value);

    if (value.trim()) {
      setDraftWarning(null);
    }
  }

  function handleInteractionCaseChange(nextCase: InteractionInputCase) {
    setInteractionCase(nextCase);
    setDraftWarning(null);
  }

  function handleSubmit() {
    if (interactionCase !== "free_text_only") {
      return;
    }

    void sendInteraction({
      inputMode: "free_text",
      action: null,
      text: draft,
    });
  }

  function handleAction(action: PlayerAction) {
    if (interactionCase === "free_text_only") {
      return;
    }

    if (interactionCase === "intent_only") {
      void sendInteraction({
        inputMode: "action",
        action,
        text: "",
      });
      return;
    }

    if (!draft.trim()) {
      setDraftWarning("대사를 입력하세요");
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
          eyebrow="Prototype"
          title="NPC Simulator"
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
            npcs={world.npcs}
            selectedNpcId={selectedNpc.persona.id}
            onSelect={setSelectedNpcId}
          />

          <div className="flex flex-col gap-4">
            <NpcCard npc={selectedNpc} quests={relatedQuests} />
            <InteractionPanel
              npc={selectedNpc}
              conversation={conversation}
              draft={draft}
              busy={busy}
              interactionCase={interactionCase}
              lastOutcome={lastOutcome}
              draftWarning={draftWarning}
              onDraftChange={handleDraftChange}
              onInteractionCaseChange={handleInteractionCaseChange}
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
