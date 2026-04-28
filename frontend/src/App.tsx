import { ApiDiagnosticsPanel } from "@/components/diagnostics/api-diagnostics-panel";
import { HubRoute } from "@/components/hub/hub-route";
import { ReviewRoute } from "@/components/review/review-route";

export function App() {
  const pathname = window.location.pathname;

  if (pathname.startsWith("/review")) {
    return (
      <>
        <ReviewRoute />
        <ApiDiagnosticsPanel />
      </>
    );
  }

  return (
    <>
      <HubRoute />
      <ApiDiagnosticsPanel />
    </>
  );
}
