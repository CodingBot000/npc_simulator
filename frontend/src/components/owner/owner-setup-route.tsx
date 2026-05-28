import { useEffect, useState } from "react";
import { apiRegisterOwnerVisitor } from "@/lib/api-client";

type OwnerSetupState = "pending" | "success" | "missing_token" | "failed";

export function OwnerSetupRoute() {
  const [state, setState] = useState<OwnerSetupState>("pending");

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token")?.trim();

    if (!token) {
      setState("missing_token");
      return;
    }

    window.history.replaceState(null, "", "/owner-setup");
    const ownerToken = token;

    async function register() {
      try {
        await apiRegisterOwnerVisitor(ownerToken);
        setState("success");
      } catch {
        setState("failed");
      }
    }

    void register();
  }, []);

  const message =
    state === "success"
      ? "Owner 등록 완료"
      : state === "missing_token"
        ? "Owner token이 없습니다"
        : state === "failed"
          ? "Owner 등록 실패"
          : "Owner 등록 중";

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--page-bg)] px-6">
      <section className="rounded-[8px] border border-[var(--panel-border)] bg-white px-6 py-5 text-center shadow-sm">
        <p className="text-sm font-semibold text-foreground">{message}</p>
      </section>
    </main>
  );
}
