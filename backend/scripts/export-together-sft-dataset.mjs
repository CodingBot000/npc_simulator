import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Together conversational SFT accepts the same JSONL `messages` structure that our
// existing local SFT exporter already emits. Keep a dedicated entrypoint so the
// training pipeline can switch semantics without duplicating dataset logic.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const targetScript = path.join(currentDir, "export-mlx-sft-dataset.mjs");

await import(pathToFileURL(targetScript).href);
