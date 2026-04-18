import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  GenerateInteractionInput,
  LlmInteractionResult,
} from "@/lib/types";
import { safeJsonParse, stripCodeFence } from "@/lib/utils";
import { PROJECT_ROOT } from "@server/config";
import { buildNpcInteractionMessages } from "@server/engine/intent";
import {
  llmInteractionSchema,
  NPC_INTERACTION_JSON_SCHEMA,
} from "@server/providers/llm-provider";
import { getInteractionModelCandidates } from "@server/providers/model-registry";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: string[],
  options: { stdin?: string; timeoutMs?: number } = {},
) {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? 120000}ms.`));
    }, options.timeoutMs ?? 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }

    child.stdin.end();
  });
}

export class CodexProvider {
  readonly mode = "codex" as const;

  async generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult> {
    const { systemPrompt, userPrompt } = buildNpcInteractionMessages(input);
    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    let lastError: Error | null = null;

    for (const model of getInteractionModelCandidates()) {
      try {
        return await this.runCodexPrompt(model, prompt);
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error("Codex provider failed with an unknown error.");
      }
    }

    throw lastError ?? new Error("Codex provider failed without an error message.");
  }

  private async runCodexPrompt(
    model: string,
    prompt: string,
  ): Promise<LlmInteractionResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "npc-sim-codex-"));
    const schemaPath = path.join(tempDir, "schema.json");
    const outputPath = path.join(tempDir, "response.json");

    try {
      await fs.writeFile(
        schemaPath,
        JSON.stringify(NPC_INTERACTION_JSON_SCHEMA, null, 2),
        "utf8",
      );

      const result = await runCommand(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
          "-C",
          PROJECT_ROOT,
          "-m",
          model,
          "--output-schema",
          schemaPath,
          "-o",
          outputPath,
          "-",
        ],
        { stdin: prompt, timeoutMs: 120000 },
      );

      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "codex exec returned a non-zero exit code.");
      }

      const fileOutput = await fs.readFile(outputPath, "utf8");
      const parsed = safeJsonParse<unknown>(stripCodeFence(fileOutput));

      if (!parsed) {
        throw new Error("Codex CLI did not return valid JSON.");
      }

      return llmInteractionSchema.parse(parsed) as LlmInteractionResult;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
