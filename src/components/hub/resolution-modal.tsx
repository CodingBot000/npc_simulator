import { useEffect } from "react";
import { DEFAULT_PLAYER_ID, DEFAULT_PLAYER_LABEL } from "@/lib/constants";
import type { WorldSnapshot } from "@/lib/types";
import { Panel } from "@/components/ui/panel";

interface ResolutionModalProps {
  open: boolean;
  busy: boolean;
  world: WorldSnapshot;
  onClose: () => void;
  onRestart: () => void;
}

function formatCast(labels: string[]) {
  if (labels.length === 0) {
    return "";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]}와 ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, 그리고 ${labels.at(-1)}`;
}

export function ResolutionModal({
  open,
  busy,
  world,
  onClose,
  onRestart,
}: ResolutionModalProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !world.resolution.resolved) {
    return null;
  }

  const sacrificedId = world.resolution.sacrificedNpcId;
  const leftBehindLabel =
    world.resolution.sacrificedLabel ??
    (sacrificedId === DEFAULT_PLAYER_ID ? DEFAULT_PLAYER_LABEL : "이름 미상");
  const escapedNames = [
    ...world.npcs
      .filter((npc) => npc.persona.id !== sacrificedId)
      .map((npc) => npc.persona.name),
    ...(sacrificedId === DEFAULT_PLAYER_ID ? [] : [DEFAULT_PLAYER_LABEL]),
  ];
  const escapedCast = formatCast(escapedNames);
  const endingLine =
    sacrificedId === DEFAULT_PLAYER_ID
      ? `${escapedCast}만 탈출한다. 당신은 침수되는 밸브실에 남아 그대로 죽음을 기다린다.`
      : `${escapedCast}만 탈출한다. ${leftBehindLabel}은 침수되는 밸브실에 남아 그대로 죽음을 기다린다.`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(3,10,17,0.78)] p-8 backdrop-blur-sm">
      <Panel
        eyebrow="Game Over"
        title="탈출 확정"
        subtitle={world.resolution.summary ?? "희생 대상이 최종 확정됐다."}
        className="flex w-full max-w-[760px] flex-col"
      >
        <div className="space-y-5">
          <div className="rounded-[24px] border border-[rgba(214,90,90,0.35)] bg-[rgba(120,32,33,0.16)] px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--danger)]">
              최종 남겨진 자
            </p>
            <p className="display-heading text-4xl font-semibold text-foreground">
              {leftBehindLabel}
            </p>
          </div>

          <p className="text-base leading-8 text-[var(--ink-muted)]">{endingLine}</p>

          {world.datasetExportedAt ? (
            <div className="rounded-[18px] border border-[var(--panel-border)] bg-white/12 px-4 py-3 text-sm leading-6 text-[var(--ink-muted)]">
              <p className="font-semibold text-foreground">Dataset export complete</p>
              <p>Episode {world.episodeId}</p>
              {world.exportPaths.richTrace ? <p>{world.exportPaths.richTrace}</p> : null}
              {world.exportPaths.sft ? <p>{world.exportPaths.sft}</p> : null}
              {world.exportPaths.review ? <p>{world.exportPaths.review}</p> : null}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--panel-border)] bg-white/12 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-[var(--teal)] hover:bg-white/18"
            >
              팝업닫고 로그읽기
            </button>
            <button
              type="button"
              onClick={onRestart}
              disabled={busy}
              className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "재시작 중..." : "게임재시작하기"}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
