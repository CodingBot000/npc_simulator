function normalizeBaseUrl(value: string | undefined | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function getClientApiBaseUrl() {
  return (
    normalizeBaseUrl(window.__NPC_SIMULATOR_CONFIG__?.apiBaseUrl) ??
    normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL) ??
    "http://localhost:8080"
  );
}

export function buildClientApiUrl(pathname: string) {
  const baseUrl = getClientApiBaseUrl();
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
