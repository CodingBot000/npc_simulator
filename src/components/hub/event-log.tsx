import type { EventLogEntry } from "@/lib/types";
import { formatTimestampShort } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";

const toneClasses: Record<EventLogEntry["tone"], string> = {
  info: "bg-sky-100 text-sky-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
};

export function EventLog({ events }: { events: EventLogEntry[] }) {
  return (
    <Panel
      eyebrow="Chamber Log"
      title="통제실 로그"
      subtitle="새로 드러난 기록, 구조 지연, 압력 이동의 흔적"
    >
      <div className="space-y-3">
        {events.map((event) => (
          <article
            key={event.id}
            className="rounded-[22px] border border-[var(--panel-border)] bg-white/20 px-4 py-4"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{event.title}</h3>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneClasses[event.tone]}`}
                >
                  {event.tone}
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
    </Panel>
  );
}
