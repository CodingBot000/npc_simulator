import { spawn } from "node:child_process";
import type { ReviewFinalizeStatusView } from "@backend-contracts/review";
import { PROJECT_ROOT } from "@server/config";
import {
  createFinalizeRunInDb,
  getReviewFinalizeStatusFromDb,
  syncSnapshotsFromFilesToDb,
  updateFinalizeRunInDb,
} from "@server/db/review-db";

let activeRun: Promise<ReviewFinalizeStatusView> | null = null;

function runNodeScript(args: string[]) {
  return new Promise<{ stdout: string; stderr: string; durationMs: number }>(
    (resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(process.execPath, args, {
        cwd: PROJECT_ROOT,
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

export async function getReviewFinalizeStatus(): Promise<ReviewFinalizeStatusView> {
  return getReviewFinalizeStatusFromDb();
}

export async function runReviewFinalize(): Promise<ReviewFinalizeStatusView> {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    const status = await getReviewFinalizeStatusFromDb();

    if (status.pending.total > 0) {
      throw new Error("사람 검수 미완료 항목이 남아 있어 finalize를 실행할 수 없습니다.");
    }

    if (!status.canFinalize) {
      throw new Error(status.message ?? "finalize를 실행할 수 없습니다.");
    }

    const startedAt = new Date().toISOString();
    const { runUid } = await createFinalizeRunInDb();

    try {
      const sftResult = await runNodeScript([
        "backend/scripts/finalize-sft-dataset.mjs",
        "--keep-input",
        "data/evals/filtered-live/keep_sft.jsonl",
        "--output-dir",
        "data/train/sft/live",
      ]);

      await updateFinalizeRunInDb({
        runUid,
        state: "running",
        currentStep: "finalize_preference",
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
      });

      const preferenceResult = await runNodeScript([
        "backend/scripts/finalize-preference-dataset.mjs",
        "--pairs-input",
        "data/evals/preference/candidate_pairs_live_gap1.jsonl",
        "--output-dir",
        "data/train/preference/live",
      ]);

      await syncSnapshotsFromFilesToDb();

      const finishedAt = new Date().toISOString();
      await updateFinalizeRunInDb({
        runUid,
        state: "succeeded",
        currentStep: null,
        message: "finalize 완료",
        finishedAt,
        durations: {
          sftMs: sftResult.durationMs,
          preferenceMs: preferenceResult.durationMs,
          totalMs: Date.parse(finishedAt) - Date.parse(startedAt),
        },
        outputs: {
          sft: sftResult.stdout || null,
          preference: preferenceResult.stdout || null,
        },
      });

      return getReviewFinalizeStatusFromDb();
    } catch (error) {
      const failedAt = new Date().toISOString();
      await updateFinalizeRunInDb({
        runUid,
        state: "failed",
        currentStep: null,
        message:
          error instanceof Error ? error.message : "finalize 실행에 실패했습니다.",
        finishedAt: failedAt,
      });
      throw error;
    }
  })();

  try {
    return await activeRun;
  } finally {
    activeRun = null;
  }
}
