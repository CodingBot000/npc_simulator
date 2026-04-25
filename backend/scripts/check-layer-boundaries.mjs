import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const BACKEND_SCRIPTS_DIR = path.dirname(SCRIPT_PATH);
const LEGACY_SHARED_DIR = path.join(BACKEND_SCRIPTS_DIR, "shared");
const TRACKED_LAYERS = new Set([
  "contracts",
  "domain",
  "persistence",
  "provider",
  "support",
  "server",
  "runtime",
  "review",
  "api",
  "entrypoint",
]);

const allowedTargetsByLayer = {
  contracts: new Set(["contracts"]),
  domain: new Set(["contracts", "domain"]),
  persistence: new Set(["contracts", "domain", "persistence"]),
  provider: new Set(["contracts", "domain", "provider"]),
  support: new Set(["support"]),
  server: new Set([
    "contracts",
    "domain",
    "persistence",
    "provider",
    "support",
    "server",
  ]),
  runtime: new Set([
    "contracts",
    "domain",
    "persistence",
    "provider",
    "support",
    "server",
    "runtime",
  ]),
  review: new Set([
    "contracts",
    "domain",
    "persistence",
    "provider",
    "support",
    "server",
    "review",
  ]),
  api: new Set([
    "contracts",
    "domain",
    "persistence",
    "provider",
    "support",
    "server",
    "runtime",
    "api",
  ]),
  entrypoint: new Set([
    "contracts",
    "domain",
    "persistence",
    "provider",
    "support",
    "server",
    "runtime",
    "review",
    "api",
    "entrypoint",
  ]),
};

const aliasToLayer = new Map([
  ["@backend-contracts/api", "contracts"],
  ["@backend-contracts/review", "contracts"],
  ["@backend-domain", "domain"],
  ["@backend-persistence", "persistence"],
  ["@backend-provider", "provider"],
  ["@backend-support/constants", "support"],
  ["@backend-support/utils", "support"],
  ["@server/", "server"],
]);

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function getLayerForRelativePath(relativeFilePath) {
  const normalized = toPosixPath(relativeFilePath);
  const [firstSegment] = normalized.split("/");

  if (TRACKED_LAYERS.has(firstSegment) && firstSegment !== "entrypoint") {
    return firstSegment;
  }

  if (!normalized.includes("/") && normalized.endsWith(".ts")) {
    return "entrypoint";
  }

  return null;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectTypeScriptFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectImportSpecifiers(sourceText) {
  const specifiers = [];
  const fromPattern = /\bfrom\s+["']([^"']+)["']/g;
  const sideEffectPattern = /^\s*import\s+["']([^"']+)["']/gm;

  for (const match of sourceText.matchAll(fromPattern)) {
    specifiers.push(match[1]);
  }

  for (const match of sourceText.matchAll(sideEffectPattern)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function getLayerForAlias(specifier) {
  for (const [alias, layer] of aliasToLayer.entries()) {
    if (specifier === alias || specifier.startsWith(alias)) {
      return layer;
    }
  }

  return null;
}

async function resolveLocalImport(sourceFilePath, specifier) {
  const basePath = path.resolve(path.dirname(sourceFilePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mjs`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.js"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isInternalRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

async function main() {
  const failures = [];

  if (await pathExists(LEGACY_SHARED_DIR)) {
    failures.push(
      "Legacy directory `backend/scripts/shared` must not exist. Use contracts/domain/persistence/provider/support instead.",
    );
  }

  const files = (await collectTypeScriptFiles(BACKEND_SCRIPTS_DIR)).sort();

  for (const filePath of files) {
    const relativeFilePath = toPosixPath(path.relative(BACKEND_SCRIPTS_DIR, filePath));

    if (relativeFilePath === "check-layer-boundaries.mjs") {
      continue;
    }

    const sourceLayer = getLayerForRelativePath(relativeFilePath);
    if (!sourceLayer) {
      continue;
    }

    const sourceText = await fs.readFile(filePath, "utf8");
    const specifiers = collectImportSpecifiers(sourceText);
    const allowedTargets = allowedTargetsByLayer[sourceLayer];

    for (const specifier of specifiers) {
      if (specifier.startsWith("@backend-shared/")) {
        failures.push(
          `${relativeFilePath}: deprecated alias \`${specifier}\` is forbidden.`,
        );
        continue;
      }

      let targetLayer = getLayerForAlias(specifier);

      if (!targetLayer && isInternalRelativeSpecifier(specifier)) {
        const resolvedPath = await resolveLocalImport(filePath, specifier);

        if (!resolvedPath) {
          continue;
        }

        const relativeTargetPath = toPosixPath(
          path.relative(BACKEND_SCRIPTS_DIR, resolvedPath),
        );
        targetLayer = getLayerForRelativePath(relativeTargetPath);

        if (
          !targetLayer &&
          relativeTargetPath.startsWith("shared/")
        ) {
          failures.push(
            `${relativeFilePath}: legacy shared path \`${specifier}\` is forbidden.`,
          );
        }
      }

      if (!targetLayer) {
        continue;
      }

      if (!allowedTargets.has(targetLayer)) {
        failures.push(
          `${relativeFilePath}: ${sourceLayer} layer must not import ${targetLayer} layer via \`${specifier}\`.`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error("Layer boundary check failed:\n");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Layer boundary check passed.");
}

await main();
