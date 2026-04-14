import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ReviewFinalizeStatusView } from "@/lib/review-types";

const REVIEW_DIR = path.join(process.cwd(), "data", "review", "live");
const STATUS_FILE = path.join(REVIEW_DIR, "finalize-status.json");

const SFT_REVIEW_FILE = path.join(REVIEW_DIR, "human_review_sft_queue.json");
const PAIR_REVIEW_FILE = path.join(REVIEW_DIR, "human_review_pair_queue.json");

let activeRun: Promise<ReviewFinalizeStatusView> | null = null;

type RawRecord = Record<string, unknown>;

function asObject(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function readJsonArray(filePath: string): Promise<RawRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is RawRecord =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function computePendingCounts() {
  const [sftItems, pairItems] = await Promise.all([
    readJsonArray(SFT_REVIEW_FILE),
    readJsonArray(PAIR_REVIEW_FILE),
  ]);

  const sft = sftItems.filter((item) => !asString(asObject(item).decision)).length;
  const pair = pairItems.filter((item) => !asString(asObject(item).decision)).length;

  return {
    sft,
    pair,
    total: sft + pair,
  };
}

async function getLatestInputUpdatedAt(): Promise<string | null> {
  const timestamps = await Promise.all(
    [SFT_REVIEW_FILE, PAIR_REVIEW_FILE].map(async (filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return stats.mtime.toISOString();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    }),
  );

  return timestamps
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function buildBaseStatus(
  partial: Partial<ReviewFinalizeStatusView>,
  pending: ReviewFinalizeStatusView["pending"],
  latestInputUpdatedAt: string | null,
): ReviewFinalizeStatusView {
  const finishedAtMs = partial.finishedAt ? Date.parse(partial.finishedAt) : Number.NaN;
  const latestInputUpdatedAtMs = latestInputUpdatedAt
    ? Date.parse(latestInputUpdatedAt)
    : Number.NaN;
  const inputsChangedAfterFinalize =
    Number.isFinite(finishedAtMs) &&
    Number.isFinite(latestInputUpdatedAtMs) &&
    latestInputUpdatedAtMs > finishedAtMs;
  const canFinalize =
    pending.total === 0 &&
    partial.state !== "running" &&
    (partial.state !== "succeeded" || inputsChangedAfterFinalize);

  return {
    state: partial.state ?? "idle",
    canFinalize,
    pending,
    currentStep: partial.currentStep ?? null,
    message: partial.message ?? null,
    startedAt: partial.startedAt ?? null,
    finishedAt: partial.finishedAt ?? null,
    updatedAt: partial.updatedAt ?? null,
    durations: {
      sftMs: partial.durations?.sftMs ?? null,
      preferenceMs: partial.durations?.preferenceMs ?? null,
      totalMs: partial.durations?.totalMs ?? null,
    },
    outputs: {
      sft: partial.outputs?.sft ?? null,
      preference: partial.outputs?.preference ?? null,
    },
  };
}

async function writeStatus(status: ReviewFinalizeStatusView) {
  await fs.mkdir(REVIEW_DIR, { recursive: true });
  await fs.writeFile(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function getReviewFinalizeStatus(): Promise<ReviewFinalizeStatusView> {
  const pending = await computePendingCounts();
  const latestInputUpdatedAt = await getLatestInputUpdatedAt();

  try {
    const raw = await fs.readFile(STATUS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ReviewFinalizeStatusView>;
    return buildBaseStatus(parsed, pending, latestInputUpdatedAt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return buildBaseStatus({}, pending, latestInputUpdatedAt);
    }
    throw error;
  }
}

function runNodeScript(args: string[]) {
  return new Promise<{ stdout: string; stderr: string; durationMs: number }>(
    (resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        const durationMs = Date.now() - startedAt;
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || "finalize 실행 실패"));
          return;
        }

        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), durationMs });
      });
    },
  );
}

export async function runReviewFinalize(): Promise<ReviewFinalizeStatusView> {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    const pending = await computePendingCounts();
    if (pending.total > 0) {
      const blockedStatus = buildBaseStatus(
        {
          state: "idle",
          message: "사람 검수 미완료 항목이 남아 있어 finalize를 실행할 수 없습니다.",
          updatedAt: new Date().toISOString(),
        },
        pending,
        await getLatestInputUpdatedAt(),
      );
      await writeStatus(blockedStatus);
      throw new Error(blockedStatus.message ?? "finalize를 실행할 수 없습니다.");
    }

    const startedAt = new Date().toISOString();
    await writeStatus(
      buildBaseStatus(
        {
          state: "running",
          currentStep: "finalize_sft",
          startedAt,
          updatedAt: startedAt,
          message: "SFT finalize 실행 중",
        },
        pending,
        await getLatestInputUpdatedAt(),
      ),
    );

    try {
      const sftResult = await runNodeScript([
        "scripts/finalize-sft-dataset.mjs",
        "--keep-input",
        "data/evals/filtered-live/keep_sft.jsonl",
        "--review-input",
        "data/review/live/human_review_sft_queue.jsonl",
        "--output-dir",
        "data/train/sft/live",
      ]);

      await writeStatus(
        buildBaseStatus(
          {
            state: "running",
            currentStep: "finalize_preference",
            startedAt,
            updatedAt: new Date().toISOString(),
            message: "Preference finalize 실행 중",
            durations: {
              sftMs: sftResult.durationMs,
              preferenceMs: null,
              totalMs: null,
            },
            outputs: {
              sft: sftResult.stdout || null,
              preference: null,
            },
          },
          pending,
          await getLatestInputUpdatedAt(),
        ),
      );

      const preferenceResult = await runNodeScript([
        "scripts/finalize-preference-dataset.mjs",
        "--pairs-input",
        "data/evals/preference/candidate_pairs_live_gap1.jsonl",
        "--review-input",
        "data/review/live/human_review_pair_queue.jsonl",
        "--output-dir",
        "data/train/preference/live",
      ]);

      const finishedAt = new Date().toISOString();
      const status = buildBaseStatus(
        {
          state: "succeeded",
          currentStep: null,
          startedAt,
          finishedAt,
          updatedAt: finishedAt,
          message: "finalize 완료",
          durations: {
            sftMs: sftResult.durationMs,
            preferenceMs: preferenceResult.durationMs,
            totalMs: sftResult.durationMs + preferenceResult.durationMs,
          },
          outputs: {
            sft: sftResult.stdout || null,
            preference: preferenceResult.stdout || null,
          },
        },
        await computePendingCounts(),
        await getLatestInputUpdatedAt(),
      );
      await writeStatus(status);
      return status;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const status = buildBaseStatus(
        {
          state: "failed",
          currentStep: null,
          startedAt,
          finishedAt: failedAt,
          updatedAt: failedAt,
          message:
            error instanceof Error ? error.message : "finalize 실행에 실패했습니다.",
        },
        await computePendingCounts(),
        await getLatestInputUpdatedAt(),
      );
      await writeStatus(status);
      throw error;
    }
  })();

  try {
    return await activeRun;
  } finally {
    activeRun = null;
  }
}
