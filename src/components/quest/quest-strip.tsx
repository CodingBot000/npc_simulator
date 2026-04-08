import type { Quest } from "@/lib/types";

const statusLabels: Record<Quest["status"], string> = {
  locked: "잠금",
  available: "가능",
  active: "진행",
  completed: "완료",
  failed: "실패",
};

const statusClasses: Record<Quest["status"], string> = {
  locked: "bg-stone-200 text-stone-600",
  available: "bg-[var(--teal-soft)] text-[var(--teal)]",
  active: "bg-[var(--accent-soft)] text-[var(--accent)]",
  completed: "bg-emerald-100 text-[var(--success)]",
  failed: "bg-rose-100 text-[var(--danger)]",
};

export function QuestStrip({ quests }: { quests: Quest[] }) {
  if (quests.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--panel-border)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        이 NPC에 직접 연결된 퀘스트는 아직 없다.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {quests.map((quest) => (
        <article
          key={quest.id}
          className="min-w-[220px] flex-1 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-strong)] px-4 py-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">{quest.title}</h3>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClasses[quest.status]}`}
            >
              {statusLabels[quest.status]}
            </span>
          </div>
          <p className="text-sm leading-6 text-[var(--ink-muted)]">{quest.summary}</p>
        </article>
      ))}
    </div>
  );
}
