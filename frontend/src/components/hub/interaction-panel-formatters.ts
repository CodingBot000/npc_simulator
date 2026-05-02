import type { InteractionTraceEntry, RoundState } from "@/lib/types";
import type {
  ConversationMessage,
  FailureDebugEntry,
  InteractionTraceTurn,
} from "@/components/hub/interaction-panel-types";

export const SHOW_INTERACTION_FAILURE_DEBUG =
  (import.meta.env.VITE_SHOW_INTERACTION_FAILURE_DEBUG ?? "true").toLowerCase() !==
  "false";

export function roundStatus(round: RoundState) {
  if (round.currentRound === 0) {
    return "아직 첫 턴 전이다. 지금 시작하는 한 마디가 첫 압력 이동이 된다.";
  }

  if (round.currentRound < round.minRoundsBeforeResolution) {
    return `지금은 ${round.currentRound}라운드다. 결말 전까지 아직 흔들 여지가 남아 있다.`;
  }

  return `지금은 ${round.currentRound}라운드다. 이제 판세가 굳으면 바로 결말이 날 수 있다.`;
}

export function formatConversationTimestamp(timestamp: string) {
  const source = new Date(timestamp);

  if (Number.isNaN(source.getTime())) {
    return "--.-- --:--:--";
  }

  const kst = new Date(source.getTime() + 9 * 60 * 60 * 1000);
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const hour = String(kst.getUTCHours()).padStart(2, "0");
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  const second = String(kst.getUTCSeconds()).padStart(2, "0");

  return `${month}.${day} ${hour}:${minute}:${second}`;
}

export function formatElapsedDuration(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}분 ${String(seconds).padStart(2, "0")}초`;
  }

  return `${totalSeconds}초`;
}

export function formatReplyRewriteSource(source: string | null | undefined) {
  const normalized = source?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const [provider] = normalized.split(":");
  const locality = provider === "local" ? "local" : "remote";
  const providerLabel =
    provider && provider !== "local" ? provider.replace(/_/gu, "-") : null;
  const baseten400ToOpenAiFallback = normalized.includes("fallback_from_baseten_400");

  const formatLabel = (modelLabel: string) =>
    [
      locality,
      providerLabel,
      modelLabel,
      baseten400ToOpenAiFallback ? "baseten400→openai" : null,
    ]
      .filter(Boolean)
      .join(" · ");

  if (normalized.includes("llama")) {
    return formatLabel("llama");
  }

  if (normalized.includes("qwen")) {
    return formatLabel("qwen");
  }

  if (/gpt[-_]?5\.4/u.test(normalized)) {
    return formatLabel("gpt5.4");
  }

  if (/gpt[-_\w.]*nano/u.test(normalized)) {
    return formatLabel("gpt-nano");
  }

  if (/gpt[-_\w.]*mini/u.test(normalized)) {
    return formatLabel("gpt-mini");
  }

  const gptVersion = normalized.match(/gpt[-_]?(\d+(?:\.\d+)?)/u);
  if (gptVersion) {
    return formatLabel(`gpt${gptVersion[1]}`);
  }

  return [
    locality,
    providerLabel,
    baseten400ToOpenAiFallback ? "baseten400→openai" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatReplyRewriteReason(reason: string | null | undefined) {
  const normalized = reason?.trim();
  return normalized ? normalized : null;
}

export function formatTraceDuration(durationMs: number) {
  if (durationMs >= 60_000) {
    return `${(durationMs / 60_000).toFixed(2)}m`;
  }
  if (durationMs >= 1_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`;
  }
  return `${durationMs}ms`;
}

export function formatTraceStatus(status: InteractionTraceEntry["status"]) {
  switch (status) {
    case "ok":
      return "정상";
    case "failed":
      return "실패";
    case "fallback":
      return "fallback";
    case "skipped":
      return "건너뜀";
    default:
      return status;
  }
}

export function formatJudgeBoolean(value: boolean | null | undefined) {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "n/a";
}

export function buildInteractionTraceTurns(
  conversation: ConversationMessage[],
  replyElapsedByMessageId: Record<string, number>,
) {
  const turns: InteractionTraceTurn[] = [];

  for (let index = 0; index < conversation.length; index += 1) {
    const message = conversation[index];
    if (message.speaker !== "npc") {
      continue;
    }

    let playerMessage: ConversationMessage | null = null;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = conversation[cursor];
      if (candidate.speaker === "player") {
        playerMessage = candidate;
        break;
      }
    }

    turns.push({
      npcMessage: message,
      playerMessage,
      traceEntries: message.interactionTrace ?? [],
      frontendElapsedMs:
        message.speaker === "npc" &&
        replyElapsedByMessageId[message.id] !== undefined
          ? replyElapsedByMessageId[message.id]
          : null,
    });
  }

  return turns.reverse();
}

export function formatFailureDebugStage(params: {
  entry: FailureDebugEntry;
  replyRewriteReason: string | null;
}) {
  switch (params.entry.stage) {
    case "interaction_provider":
      return "기본 생성 실패";
    case "interaction_validation":
      return "기본 생성 검증 실패";
    case "reply_rewrite":
      return params.replyRewriteReason ? "최종 rewrite 실패" : "rewrite 중간 실패";
    default:
      return "실패";
  }
}

