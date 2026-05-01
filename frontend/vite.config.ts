import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";

const SOURCE_VERSION_MODULE_ID = "virtual:npc-simulator-source-version";
const RESOLVED_SOURCE_VERSION_MODULE_ID = `\0${SOURCE_VERSION_MODULE_ID}`;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const VERSIONED_SOURCE_ROOTS = [
  fileURLToPath(new URL("./src", import.meta.url)),
  fileURLToPath(new URL("../backend/src", import.meta.url)),
  fileURLToPath(new URL("../backend/scripts", import.meta.url)),
  fileURLToPath(new URL("../contracts/src", import.meta.url)),
  fileURLToPath(new URL("../shared", import.meta.url)),
];
const VERSIONED_SOURCE_FILES = [
  fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
  fileURLToPath(new URL("./package.json", import.meta.url)),
  fileURLToPath(new URL("../backend/Dockerfile", import.meta.url)),
  fileURLToPath(new URL("../backend/build.gradle.kts", import.meta.url)),
  fileURLToPath(new URL("../package.json", import.meta.url)),
  fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  fileURLToPath(new URL("../contracts/openapi/current.yaml", import.meta.url)),
];
const VERSIONED_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const IGNORED_SOURCE_DIRS = new Set([
  ".gradle",
  ".next",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function isVersionedFile(filePath: string) {
  const basename = path.basename(filePath);
  return basename === "Dockerfile" || VERSIONED_EXTENSIONS.has(path.extname(filePath));
}

function latestMtimeMs(targetPath: string): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return isVersionedFile(targetPath) ? stat.mtimeMs : 0;
  }

  if (!stat.isDirectory() || IGNORED_SOURCE_DIRS.has(path.basename(targetPath))) {
    return 0;
  }

  return fs.readdirSync(targetPath, { withFileTypes: true }).reduce((latest, entry) => {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory() && IGNORED_SOURCE_DIRS.has(entry.name)) {
      return latest;
    }
    return Math.max(latest, latestMtimeMs(entryPath));
  }, stat.mtimeMs);
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatSourceVersion(timestampMs: number) {
  const date = new Date((timestampMs || Date.now()) + KST_OFFSET_MS);
  return [
    "ver",
    `${date.getUTCFullYear()}${padDatePart(date.getUTCMonth() + 1)}${padDatePart(date.getUTCDate())}`,
    `${padDatePart(date.getUTCHours())}${padDatePart(date.getUTCMinutes())}${padDatePart(date.getUTCSeconds())}`,
  ].join("_");
}

function buildSourceVersion() {
  const latestRootTime = VERSIONED_SOURCE_ROOTS.reduce(
    (latest, sourceRoot) => Math.max(latest, latestMtimeMs(sourceRoot)),
    0,
  );
  const latestFileTime = VERSIONED_SOURCE_FILES.reduce(
    (latest, sourceFile) => Math.max(latest, latestMtimeMs(sourceFile)),
    0,
  );

  return formatSourceVersion(Math.max(latestRootTime, latestFileTime));
}

function sourceVersionPlugin(): Plugin {
  return {
    name: "npc-simulator-source-version",
    resolveId(id) {
      return id === SOURCE_VERSION_MODULE_ID ? RESOLVED_SOURCE_VERSION_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_SOURCE_VERSION_MODULE_ID) {
        return null;
      }

      return `export const sourceVersion = ${JSON.stringify(buildSourceVersion())};`;
    },
    configureServer(server) {
      server.watcher.add([...VERSIONED_SOURCE_ROOTS, ...VERSIONED_SOURCE_FILES]);
      server.watcher.on("all", (_event, changedPath) => {
        if (!isVersionedFile(changedPath)) {
          return;
        }

        const module = server.moduleGraph.getModuleById(RESOLVED_SOURCE_VERSION_MODULE_ID);
        if (module) {
          server.moduleGraph.invalidateModule(module);
        }
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

export default defineConfig({
  plugins: [sourceVersionPlugin(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@contracts": fileURLToPath(new URL("../contracts/generated", import.meta.url)),
      "@sim-shared": fileURLToPath(new URL("../shared/simulator-rules", import.meta.url)),
      "@sim-presentation": fileURLToPath(
        new URL("../shared/simulator-presentation", import.meta.url),
      ),
    },
  },
  server: {
    port: 3000,
  },
});
