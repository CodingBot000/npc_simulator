/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SHOW_INTERACTION_FAILURE_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __NPC_SIMULATOR_CONFIG__?: {
    apiBaseUrl?: string;
    source?: "NPC_SIMULATOR_API_BASE_URL" | "VITE_API_BASE_URL" | null;
  };
}
