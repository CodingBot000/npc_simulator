import { ApiDiagnosticsPanel } from "@/components/diagnostics/api-diagnostics-panel";
import { HubRoute } from "@/components/hub/hub-route";
import { OwnerSetupRoute } from "@/components/owner/owner-setup-route";
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
