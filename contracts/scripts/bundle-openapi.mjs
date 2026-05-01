import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const sourcePath = path.join(repoRoot, "contracts/openapi/current.yaml");
const outputPath = path.join(repoRoot, "contracts/openapi/bundled.yaml");

function quoteKey(key) {
  return /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key);
}

function scalarToYaml(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function jsonToYaml(value, indent = 0) {
  const pad = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    return value
      .map((entry) => {
        if (entry && typeof entry === "object") {
          return `${pad}-\n${jsonToYaml(entry, indent + 2)}`;
        }
        return `${pad}- ${scalarToYaml(entry)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "{}";
    }

    return entries
      .map(([key, entry]) => {
        const label = quoteKey(key);
        if (entry && typeof entry === "object") {
          return `${pad}${label}:\n${jsonToYaml(entry, indent + 2)}`;
        }
        return `${pad}${label}: ${scalarToYaml(entry)}`;
      })
      .join("\n");
  }

  return `${pad}${scalarToYaml(value)}`;
}

function inlineJsonSchema(match, indent, refPath) {
  const schemaPath = path.resolve(path.dirname(sourcePath), refPath);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  return jsonToYaml(schema, indent.length);
}

const source = fs.readFileSync(sourcePath, "utf8");
const bundled = source.replace(
  /^(\s*)\$ref:\s*"(\.\.\/generated\/json-schema\/[^"]+)"\s*$/gmu,
  inlineJsonSchema,
);

fs.writeFileSync(
  outputPath,
  `# Generated from contracts/openapi/current.yaml. Do not edit by hand.\n${bundled}`,
  "utf8",
);
