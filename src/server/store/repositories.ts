import { FileWorldRepository } from "@/server/store/file-store";

export interface WorldRepository {
  ensureSeedData(): Promise<void>;
  readWorldState(): Promise<import("@/lib/types").WorldStateFile>;
  readMemoryFile(): Promise<import("@/lib/types").NpcMemoryFile>;
  readInteractionLog(): Promise<import("@/lib/types").InteractionLogFile>;
  saveWorldState(
    state: import("@/lib/types").WorldStateFile,
  ): Promise<void>;
  saveMemoryFile(
    file: import("@/lib/types").NpcMemoryFile,
  ): Promise<void>;
  saveInteractionLog(
    file: import("@/lib/types").InteractionLogFile,
  ): Promise<void>;
  resetToSeed(): Promise<void>;
}

export function createWorldRepository(): WorldRepository {
  return new FileWorldRepository();
}
