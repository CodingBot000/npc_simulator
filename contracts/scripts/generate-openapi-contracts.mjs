import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createGenerator } from "ts-json-schema-generator";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const sourcePath = path.join(repoRoot, "contracts/src/openapi-schema-source.ts");
const tsconfigPath = path.join(repoRoot, "tsconfig.json");
const schemaOutputDir = path.join(repoRoot, "contracts/generated/json-schema");
const openapiSpecPath = path.join(repoRoot, "contracts/openapi/current.yaml");
const openapiTypesPath = path.join(repoRoot, "contracts/generated/openapi-types.ts");
const openapiTypesBin = path.join(repoRoot, "node_modules/.bin/openapi-typescript");

const schemaDefinitions = [
  ["InteractionRequest", "ContractInteractionRequest"],
  ["InteractionResponse", "ContractInteractionResponse"],
  ["WorldSnapshot", "ContractWorldSnapshot"],
  ["InspectorResponse", "ContractInspectorResponse"],
  ["ReviewDashboardData", "ContractReviewDashboardData"],
  ["ReviewMutationResult", "ContractReviewMutationResult"],
  ["ReviewFinalizeStatus", "ContractReviewFinalizeStatus"],
  ["ReviewTrainingStatus", "ContractReviewTrainingStatus"],
  ["ReviewTrainingRequest", "ContractReviewTrainingRequest"],
  [
    "ReviewTrainingRunActionRequest",
    "ContractReviewTrainingRunActionRequest",
  ],
  [
    "ReviewTrainingDecisionRequest",
    "ContractReviewTrainingDecisionRequest",
  ],
  ["ReviewDecisionRequest", "ContractReviewDecisionRequest"],
  ["ReviewPipelineRunRequest", "ContractReviewPipelineRunRequest"],
  ["ReviewPipelineRunResult", "ContractReviewPipelineRunResult"],
  ["ReviewPipelineStatus", "ContractReviewPipelineStatus"],
  ["SystemInfo", "ContractSystemInfo"],
];

function writeJsonSchema(schemaName, typeName) {
  const generator = createGenerator({
    path: sourcePath,
    tsconfig: tsconfigPath,
    type: typeName,
    expose: "export",
    skipTypeCheck: false,
  });
  const schema = normalizeRootSchema(generator.createSchema(typeName));
  const outputPath = path.join(schemaOutputDir, `${schemaName}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}

function normalizeRootSchema(schema) {
  const rootRef = schema.$ref;

  if (
    typeof rootRef !== "string" ||
    !rootRef.startsWith("#/definitions/Contract") ||
    !schema.definitions
  ) {
    return schema;
  }

  const rootDefinitionKey = rootRef.replace("#/definitions/", "");
  const rootDefinition = schema.definitions[rootDefinitionKey];

  if (!rootDefinition || typeof rootDefinition !== "object") {
    return schema;
  }

  const { [rootDefinitionKey]: _, ...definitions } = schema.definitions;

  return {
    $schema: schema.$schema,
    ...rootDefinition,
    ...(Object.keys(definitions).length > 0 ? { definitions } : {}),
  };
}

fs.mkdirSync(schemaOutputDir, { recursive: true });

for (const [schemaName, typeName] of schemaDefinitions) {
  writeJsonSchema(schemaName, typeName);
}

execFileSync(openapiTypesBin, [openapiSpecPath, "-o", openapiTypesPath], {
  cwd: repoRoot,
  stdio: "inherit",
});
