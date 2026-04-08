import fs from "node:fs/promises";
import path from "node:path";
import { DATA_FILES } from "@/lib/constants";
import type {
  InteractionLogFile,
  NpcMemoryFile,
  WorldStateFile,
} from "@/lib/types";
import { DATA_DIR } from "@/server/config";
import {
  createSeedInteractionLog,
  createSeedMemoryFile,
  createSeedWorldState,
} from "@/server/seeds/world";
import type { WorldRepository } from "@/server/store/repositories";

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export class FileWorldRepository implements WorldRepository {
  private readonly worldStatePath = path.join(DATA_DIR, DATA_FILES.worldState);

  private readonly interactionLogPath = path.join(
    DATA_DIR,
    DATA_FILES.interactionLog,
  );

  private readonly npcMemoryPath = path.join(DATA_DIR, DATA_FILES.npcMemory);

  async ensureSeedData() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const checks = await Promise.allSettled([
      fs.access(this.worldStatePath),
      fs.access(this.interactionLogPath),
      fs.access(this.npcMemoryPath),
    ]);

    if (checks.some((check) => check.status === "rejected")) {
      await this.resetToSeed();
    }
  }

  async readWorldState() {
    await this.ensureSeedData();
    return readJsonFile<WorldStateFile>(this.worldStatePath);
  }

  async readMemoryFile() {
    await this.ensureSeedData();
    return readJsonFile<NpcMemoryFile>(this.npcMemoryPath);
  }

  async readInteractionLog() {
    await this.ensureSeedData();
    return readJsonFile<InteractionLogFile>(this.interactionLogPath);
  }

  async saveWorldState(state: WorldStateFile) {
    await writeJsonFile(this.worldStatePath, state);
  }

  async saveMemoryFile(file: NpcMemoryFile) {
    await writeJsonFile(this.npcMemoryPath, file);
  }

  async saveInteractionLog(file: InteractionLogFile) {
    await writeJsonFile(this.interactionLogPath, file);
  }

  async resetToSeed() {
    await Promise.all([
      writeJsonFile(this.worldStatePath, createSeedWorldState()),
      writeJsonFile(this.npcMemoryPath, createSeedMemoryFile()),
      writeJsonFile(this.interactionLogPath, createSeedInteractionLog()),
    ]);
  }
}
