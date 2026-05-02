import type { AvailableActionDefinition, PlayerAction } from "@/lib/types";
import type { PlayInputMode } from "@/components/hub/interaction-panel-types";

export function InteractionControls({
  playInputMode,
  inputModeDisabled,
  draft,
  placeholder,
  directInputDisabled,
  activeWarning,
  submitButtonClassName,
  submitButtonLabel,
  busy,
  showDirectInputCard,
  showIntentCard,
  actionButtonsDisabled,
  availableActions,
  onPlayInputModeChange,
  onDraftValueChange,
  onSubmitClick,
  onActionClick,
}: {
  playInputMode: PlayInputMode;
  inputModeDisabled: boolean;
  draft: string;
  placeholder: string;
  directInputDisabled: boolean;
  activeWarning: string | null;
  submitButtonClassName: string;
  submitButtonLabel: string;
  busy: boolean;
  showDirectInputCard: boolean;
  showIntentCard: boolean;
  actionButtonsDisabled: boolean;
  availableActions: AvailableActionDefinition[];
  onPlayInputModeChange: (nextMode: PlayInputMode) => void;
  onDraftValueChange: (value: string) => void;
  onSubmitClick: () => void;
  onActionClick: (action: PlayerAction) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
          입력 방식
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-[var(--ink-muted)]">
          <InputModeOption
            label="의도만 전달"
            checked={playInputMode === "intent_only"}
            disabled={inputModeDisabled}
            onChange={() => onPlayInputModeChange("intent_only")}
          />
          <InputModeOption
            label="자유입력"
            checked={playInputMode === "free_text"}
            disabled={inputModeDisabled}
            onChange={() => onPlayInputModeChange("free_text")}
          />
          <InputModeOption
            label="모두 사용"
            checked={playInputMode === "combined"}
            disabled={inputModeDisabled}
            onChange={() => onPlayInputModeChange("combined")}
          />
        </div>
      </div>

      {showDirectInputCard ? (
        <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              자유입력
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
              버튼으로 시작한 뒤, 필요하면 아래에 직접 한 문장을 더 얹는다.
            </p>
          </div>

          <textarea
            value={draft}
            onChange={(event) => onDraftValueChange(event.target.value)}
            placeholder={placeholder}
            disabled={directInputDisabled}
            aria-invalid={Boolean(activeWarning)}
            className={`min-h-[110px] w-full resize-none rounded-[20px] border px-4 py-3 text-sm leading-7 outline-none transition disabled:cursor-not-allowed disabled:opacity-55 ${
              activeWarning
                ? "border-[var(--danger)] bg-rose-50/70 focus:border-[var(--danger)]"
                : "border-[var(--panel-border)] bg-white/18 focus:border-[var(--accent)]"
            }`}
          />
          {activeWarning ? (
            <p className="mt-2 text-sm font-medium text-[var(--danger)]" role="alert">
              {activeWarning}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onSubmitClick}
            disabled={directInputDisabled}
            className={`mt-3 w-full rounded-full px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${submitButtonClassName}`}
          >
            {busy ? "반응을 정리하는 중..." : submitButtonLabel}
          </button>
        </div>
      ) : null}

      {showIntentCard ? (
        <div className="rounded-[24px] border border-[var(--panel-border)] bg-white/10 p-4">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              의도 전달
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
              버튼 하나로 먼저 밀고, 결과를 읽은 뒤 다음 턴을 정하면 된다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {availableActions.map((action) => {
              const badgeLabel = actionBadgeLabel(action);
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onActionClick(action.id)}
                  disabled={actionButtonsDisabled}
                  className="flex h-full flex-col justify-start rounded-[20px] border border-[var(--panel-border)] bg-white/12 px-4 py-3 text-left align-top transition hover:border-[var(--teal)] hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="block text-sm font-semibold text-foreground">
                      {action.label}
                    </span>
                    {badgeLabel ? (
                      <span
                        className={`shrink-0 whitespace-nowrap text-[11px] font-medium ${
                          action.requiresTarget ? "text-[var(--danger)]" : "text-[var(--teal)]"
                        }`}
                      >
                        {badgeLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block whitespace-normal break-keep text-[0.2rem] leading-[0.9rem] text-[var(--ink-muted)]">
                    {action.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InputModeOption({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 ${
        disabled ? "cursor-not-allowed opacity-55" : ""
      }`}
    >
      <input
        type="radio"
        name="play-input-mode"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-3.5 w-3.5 accent-[var(--accent)]"
      />
      <span>{label}</span>
    </label>
  );
}

function actionBadgeLabel(action: AvailableActionDefinition) {
  if (action.requiresTarget) {
    return "타겟 필수";
  }

  if (action.id === "appeal") {
    return "타겟유무선택";
  }

  return null;
}

