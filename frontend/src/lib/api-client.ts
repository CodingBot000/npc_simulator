function normalizeBaseUrl(value: string | undefined | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function getClientApiBaseUrl() {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) ?? "http://localhost:8080";
}

export function buildClientApiUrl(pathname: string) {
  const baseUrl = getClientApiBaseUrl();
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function getServerApiBaseUrl() {
  return (
    normalizeBaseUrl(process.env.API_BASE_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) ??
    "http://127.0.0.1:8080"
  );
}

export function buildServerApiUrl(pathname: string) {
  const baseUrl = getServerApiBaseUrl();
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
