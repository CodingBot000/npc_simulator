import type { ReactNode } from "react";

interface PanelProps {
  eyebrow?: string;
  eyebrowTrailing?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function Panel({
  eyebrow,
  eyebrowTrailing,
  title,
  subtitle,
  trailing,
  className = "",
  contentClassName = "",
  children,
}: PanelProps) {
  return (
    <section
      className={`panel-surface rounded-[28px] px-6 py-5 ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <div className="mb-1 flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--teal)]">
                {eyebrow}
              </p>
              {eyebrowTrailing ? <div className="shrink-0">{eyebrowTrailing}</div> : null}
            </div>
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
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
