import { lazy, Suspense } from "react";
import { ApiDiagnosticsPanel } from "@/components/diagnostics/api-diagnostics-panel";
import { HubRoute } from "@/components/hub/hub-route";
import { AppLoadingState } from "@/components/ui/app-loading-state";

const OwnerSetupRoute = lazy(() =>
  import("@/components/owner/owner-setup-route").then((module) => ({
    default: module.OwnerSetupRoute,
  })),
);
const ReviewRoute = lazy(() =>
  import("@/components/review/review-route").then((module) => ({
    default: module.ReviewRoute,
  })),
);

function AppRoute() {
  const pathname = window.location.pathname;

  if (pathname.startsWith("/review")) {
    return (
      <>
        <ReviewRoute />
        <ApiDiagnosticsPanel />
      </>
    );
  }

  if (pathname.startsWith("/owner-setup")) {
    return <OwnerSetupRoute />;
  }

  return (
    <>
      <HubRoute />
      <ApiDiagnosticsPanel />
    </>
  );
}

export function App() {
  return (
    <Suspense fallback={<AppLoadingState />}>
      <AppRoute />
    </Suspense>
  );
}
