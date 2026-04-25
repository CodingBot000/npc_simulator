import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const BACKEND_SCRIPTS_DIR = path.dirname(SCRIPT_PATH);

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function isTrackedTypeScriptFile(filePath) {
  return filePath.endsWith(".ts");
}

function isConfigBoundaryFile(relativeFilePath) {
  return (
    relativeFilePath === "server/config.ts" ||
    relativeFilePath.startsWith("server/config/")
  );
}

async function collectFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && isTrackedTypeScriptFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function hasForbiddenConfigHelperImport(sourceText) {
  const importPattern =
    /import\s*{([\s\S]*?)}\s*from\s*["']@server\/config["'];?/g;

  for (const match of sourceText.matchAll(importPattern)) {
    const importedNames = match[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split(/\s+as\s+/u)[0]?.trim());

    if (
      importedNames.includes("getServerEnv") ||
      importedNames.includes("hasServerEnv") ||
      importedNames.includes("getProcessEnv") ||
      importedNames.includes("serverRuntimeContext")
    ) {
      return true;
    }
  }

  return false;
}

async function main() {
  const failures = [];
  const files = await collectFiles(BACKEND_SCRIPTS_DIR);

  for (const filePath of files.sort()) {
    const relativeFilePath = toPosixPath(path.relative(BACKEND_SCRIPTS_DIR, filePath));

    if (isConfigBoundaryFile(relativeFilePath)) {
      continue;
    }

    const sourceText = await fs.readFile(filePath, "utf8");

    if (sourceText.includes(".env.local")) {
      failures.push(
        `${relativeFilePath}: direct .env.local reference is forbidden outside server/config.`,
      );
    }

    if (sourceText.includes("@server/config/env-loader")) {
      failures.push(
        `${relativeFilePath}: env-loader import is forbidden outside server/config.`,
      );
    }

    if (sourceText.includes("@server/config/runtime-context")) {
      failures.push(
        `${relativeFilePath}: runtime-context import is forbidden outside server/config.`,
      );
    }

    if (hasForbiddenConfigHelperImport(sourceText)) {
      failures.push(
        `${relativeFilePath}: import config values, not env helper functions, outside server/config.`,
      );
    }

    if (
      /\b(getServerEnv|hasServerEnv|getProcessEnv)\s*\(/u.test(sourceText)
    ) {
      failures.push(
        `${relativeFilePath}: direct env helper calls are forbidden outside server/config.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("Env boundary check failed:\n");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Env boundary check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
