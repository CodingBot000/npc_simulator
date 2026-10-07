import { useEffect, useState } from "react";
import { HubClient } from "@/components/hub/hub-client";
import { AppLoadingState } from "@/components/ui/app-loading-state";
import { Panel } from "@/components/ui/panel";
import { apiGetWorld } from "@/lib/api-client";
import type { WorldSnapshot } from "@/lib/types";

function HubErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="min-h-screen overflow-x-auto px-6 py-6">
      <div className="mx-auto flex min-w-[1280px] w-full max-w-[1540px] flex-col gap-4">
        <Panel
          eyebrow="다시 시도"
          title="상황을 다시 불러와야 한다"
          subtitle="방 안 상태를 읽지 못해서 첫 턴을 아직 열지 못했다."
        >
          <div className="space-y-4">
            <p className="rounded-2xl bg-rose-100 px-4 py-3 text-sm text-[var(--danger)]">
              {message}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-[var(--teal)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105"
            >
              다시 불러오기
            </button>
          </div>
        </Panel>
      </div>
    </main>
  );
}

export function HubRuntime() {
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorld() {
      setError(null);

      try {
        const payload = await apiGetWorld({
          cache: "no-store",
          signal: controller.signal,
        });
        setWorld(payload);
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "월드 데이터를 불러오지 못했습니다.",
        );
      }
    }

    void loadWorld();

    return () => controller.abort();
  }, [reloadToken]);

  if (error) {
    return (
      <HubErrorState
        message={error}
        onRetry={() => {
          setWorld(null);
          setReloadToken((current) => current + 1);
        }}
      />
    );
  }

  if (!world) {
    return <AppLoadingState title="펠라지아-9 상황을 불러오는 중" />;
  }

  return <HubClient initialWorld={world} />;
}
