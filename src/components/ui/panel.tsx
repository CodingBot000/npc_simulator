import type { ReactNode } from "react";

interface PanelProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({
  eyebrow,
  title,
  subtitle,
  trailing,
  className = "",
  children,
}: PanelProps) {
  return (
    <section
      className={`panel-surface rounded-[28px] px-5 py-4 md:px-6 md:py-5 ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--teal)]">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="display-heading text-2xl font-semibold text-foreground">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children}
    </section>
  );
}
