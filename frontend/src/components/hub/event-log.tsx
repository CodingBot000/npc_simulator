import type { EventLogEntry } from "@/lib/types";
import { formatTimestampShort } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";

const toneClasses: Record<EventLogEntry["tone"], string> = {
  info: "bg-sky-100 text-sky-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
};

const toneLabels: Record<EventLogEntry["tone"], string> = {
  info: "상황",
  success: "전진",
  warning: "경고",
  danger: "위기",
};

export function EventLog({ events }: { events: EventLogEntry[] }) {
  return (
    <Panel
      eyebrow="세부 기록"
      title="세부 기록"
      subtitle="첫 화면 이해가 끝난 뒤, 이전 흐름과 기록을 아래에서 다시 읽을 수 있다."
      className="play-session-card overflow-hidden"
      contentClassName="space-y-2.5"
    >
      {events.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-[var(--panel-border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
          아직 읽을 만한 세부 기록이 쌓이지 않았다.
        </div>
      ) : (
        <div className="scrollbar-thin max-h-[420px] space-y-2.5 overflow-y-auto pr-2">
          {events.map((event) => (
            <article
              key={event.id}
              className="rounded-[22px] border border-[var(--panel-border)] bg-white/14 px-4 py-3.5"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {event.title}
                </h3>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneClasses[event.tone]}`}
                  >
                    {toneLabels[event.tone]}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">
                    {formatTimestampShort(event.timestamp)}
                  </span>
                </div>
              </div>
              <p className="text-sm leading-6 text-[var(--ink-muted)]">{event.detail}</p>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
