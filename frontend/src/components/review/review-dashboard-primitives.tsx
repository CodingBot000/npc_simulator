import type { ReactNode } from "react";

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
      {children}
    </p>
  );
}

export function CardSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel-surface rounded-[28px] px-5 py-5 ${className}`}>
      {children}
    </section>
  );
}

export function TextBlock({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-sm leading-7 text-foreground/95 ${className}`}
    >
      {children}
    </div>
  );
}

export function TagRow({
  values,
  emptyLabel = "없음",
}: {
  values: string[];
  emptyLabel?: string;
}) {
  if (!values.length) {
    return <p className="text-sm text-[var(--ink-muted)]">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-foreground/85"
        >
          {value}
        </span>
      ))}
    </div>
  );
}
