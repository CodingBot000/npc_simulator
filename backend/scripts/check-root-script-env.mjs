import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const BACKEND_SCRIPTS_DIR = path.dirname(SCRIPT_PATH);
const ROOT_ALLOWED_FILES = new Set([
  "_script-runtime.mjs",
  "check-env-boundaries.mjs",
  "check-layer-boundaries.mjs",
  "check-root-script-env.mjs",
]);

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

async function collectRootScriptFiles() {
  const entries = await fs.readdir(BACKEND_SCRIPTS_DIR, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name.endsWith(".mjs") || entry.name.endsWith(".ts")) {
      files.push(path.join(BACKEND_SCRIPTS_DIR, entry.name));
    }
  }

  files.push(path.join(BACKEND_SCRIPTS_DIR, "api", "bridge.ts"));
  return files.sort();
}

async function main() {
  const failures = [];
  const files = await collectRootScriptFiles();

  for (const filePath of files) {
    const relativeFilePath = toPosixPath(path.relative(BACKEND_SCRIPTS_DIR, filePath));

    if (ROOT_ALLOWED_FILES.has(relativeFilePath)) {
      continue;
    }

    const sourceText = await fs.readFile(filePath, "utf8");
    if (sourceText.includes("process.env")) {
      failures.push(
        `${relativeFilePath}: direct process.env usage is forbidden in root scripts and workers. Use support/bootstrap.ts or _script-runtime.mjs helpers.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("Root script env check failed:\n");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Root script env check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
