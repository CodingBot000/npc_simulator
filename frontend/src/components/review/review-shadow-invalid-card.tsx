import type { ReviewShadowInvalidCaseView } from "@/lib/review-types";
import {
  formatDuration,
  formatTimestamp,
} from "./review-formatters";
import { TextBlock } from "./review-dashboard-primitives";

export function ShadowInvalidCaseCard({
  item,
}: {
  item: ReviewShadowInvalidCaseView;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/12 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[rgba(209,111,76,0.16)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
          invalid_json
        </span>
        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] text-[var(--ink-muted)]">
          turn {item.turnIndex ?? "-"}
        </span>
        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] text-[var(--ink-muted)]">
          {item.npcId}
        </span>
      </div>

      <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-muted)]">
        <p>
          episode {item.episodeId ?? "-"} · {formatTimestamp(item.exportedAt)}
        </p>
        <p>
          source {item.shadowLabel ?? "-"} · {formatDuration(item.durationMs)}
        </p>
        {item.sourceRef ? <p className="break-all">{item.sourceRef}</p> : null}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
            Player Input
          </p>
          <TextBlock>{item.playerText || "-"}</TextBlock>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
            Active Reply
          </p>
          <TextBlock>{item.activeReplyText || "-"}</TextBlock>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            Shadow Error
          </p>
          <TextBlock>{item.error || "-"}</TextBlock>
        </div>

        <details className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Raw Output 보기
          </summary>
          <TextBlock className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6">
            {item.rawOutput || "-"}
          </TextBlock>
        </details>

        {item.exportPath ? (
          <p className="text-xs leading-5 text-[var(--ink-muted)]">{item.exportPath}</p>
        ) : null}
      </div>
    </div>
  );
}
