import { basename } from "node:path";
import {
  DEFAULT_BASE_URL,
  appendJsonLine,
  basenameLabel,
  buildInstanceId,
  errorMessage,
  getBooleanOption,
  getNumberOption,
  getStringOption,
  initializeOutputFile,
  isTransientRequestError,
  loadJsonOrJsonl,
  normalizeTurns,
  parseCliArgs,
  parseCommaSeparatedOption,
  postTurnWithMetrics,
  printUsage,
  resetWorldWithMetrics,
  retryOperation,
  totalPressureDelta,
  unique,
} from "./_episode-cli-helpers.mjs";

const knownExpectationKeys = new Set([
  "mustMovePressure",
  "expectedTargetNpcId",
  "expectedImpactTagsAnyOf",
  "expectedImpactTagsAllOf",
  "minKnowledgeRetrieved",
  "minMemoriesRetrieved",
  "mustResolveByRound",
  "expectedResolutionType",
  "expectedSelectedActionAnyOf",
  "expectedSelectedActionAllOf",
  "rationaleIncludesAnyOf",
  "rationaleIncludesAllOf",
  "mustExportDataset",
  "expectedExportPathKindsAllOf",
]);

function usage() {
  printUsage([
    "Usage: node scripts/replay-eval-cases.mjs --cases <path> [options]",
    "",
    "Required:",
    "  --cases <path>                 JSON/JSONL eval case file",
    "",
    "Options:",
    "  --base-url <url>               API base URL (default: http://localhost:3000)",
    "  --case-id <id[,id]>            run only selected case ids",
    "  --instance-prefix <value>      prefix for isolated world instances",
    "  --output <path>                write JSONL result file",
    "  --fail-fast                    stop after the first failing case",
    "  --timeout-ms <n>               request timeout in ms (default: 120000)",
    "  --reset-retry-count <n>        safe retries for reset (default: 1)",
    "  --turn-retry-count <n>         retries for interact POST (default: 0, use carefully)",
    "  --retry-delay-ms <n>           delay between retries (default: 1000)",
    "  --verbose                      print per-turn details",
    "  --help                         show this message",
  ]);
}

function assertNonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function average(values) {
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : 0;
}

function normalizeCase(rawCase, index, sourceLabel) {
  if (!rawCase || typeof rawCase !== "object") {
    throw new Error(`Case ${index + 1} in ${sourceLabel} must be an object`);
  }

  if (typeof rawCase.id !== "string" || !rawCase.id) {
    throw new Error(`Case ${index + 1} in ${sourceLabel} is missing id`);
  }

  return {
    id: rawCase.id,
    description:
      typeof rawCase.description === "string" ? rawCase.description : "",
    turns: normalizeTurns(rawCase.turns ?? rawCase, `${sourceLabel}:${rawCase.id}`),
    expectations:
      rawCase.expectations && typeof rawCase.expectations === "object"
        ? rawCase.expectations
        : {},
  };
}

async function loadCases(casesPath) {
  const raw = await loadJsonOrJsonl(casesPath);
  const cases = Array.isArray(raw) ? raw : raw && Array.isArray(raw.cases) ? raw.cases : null;

  if (!cases) {
    throw new Error(`${casesPath} must contain an array of cases or an object with cases`);
  }

  return cases.map((entry, index) => normalizeCase(entry, index, casesPath));
}

function normalizeExportKinds(exportPaths) {
  return Object.entries(exportPaths ?? {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
}

function buildActualMetrics(reset, turnResults) {
  const finalOutcome = turnResults.at(-1)?.outcome ?? null;
  const finalWorld = finalOutcome?.world ?? reset;
  const targetNpcIds = unique(
    turnResults.map((entry) => entry.outcome.inspector.targetNpcId),
  );
  const impactTags = unique(
    turnResults.flatMap(
      (entry) => entry.outcome.inspector.structuredImpact.impactTags,
    ),
  );
  const selectedActions = unique(
    turnResults.map((entry) => entry.outcome.inspector.selectedAction.type),
  );
  const selectedActionReasons = turnResults.map(
    (entry) => entry.outcome.inspector.selectedActionReason,
  );
  const impactRationales = turnResults.map(
    (entry) => entry.outcome.inspector.structuredImpact.rationale,
  );
  const replyTexts = turnResults.map((entry) => entry.outcome.reply.text);
  const perTurnPressure = turnResults.map((entry, index) => ({
    turnNumber: index + 1,
    totalPressureDelta: totalPressureDelta(entry.outcome.pressureChanges),
  }));
  const knowledgeCounts = turnResults.map(
    (entry) => entry.outcome.inspector.retrievedKnowledge.length,
  );
  const memoryCounts = turnResults.map(
    (entry) => entry.outcome.inspector.retrievedMemories.length,
  );
  const confidenceValues = turnResults.map(
    (entry) => entry.outcome.inspector.structuredImpact.confidence,
  );
  const autonomyStepSequences = turnResults.map((entry) =>
    (entry.outcome.inspector.autonomyPhase?.steps ?? [])
      .map(
        (step) =>
          `${step.actorNpcId}:${step.moveType}:${step.targetNpcId ?? "-"}:${step.secondaryTargetNpcId ?? "-"}`,
      )
      .join("|"),
  );
  const exportedKinds = normalizeExportKinds(finalWorld.exportPaths);
  const requestDurations = turnResults.map((entry) => entry.requestMetrics.durationMs);
  const totalRetries = turnResults.reduce(
    (sum, entry) => sum + entry.requestMetrics.retried,
    0,
  );

  return {
    targetNpcId: targetNpcIds.at(-1) ?? null,
    targetNpcIds,
    impactTags,
    selectedActions,
    selectedActionReasons,
    impactRationales,
    replyTexts,
    pressureMovement: {
      total: perTurnPressure.reduce((sum, entry) => sum + entry.totalPressureDelta, 0),
      perTurn: perTurnPressure,
    },
    knowledgeRetrieved: {
      max: knowledgeCounts.length ? Math.max(...knowledgeCounts) : 0,
      total: knowledgeCounts.reduce((sum, value) => sum + value, 0),
    },
    memoriesRetrieved: {
      max: memoryCounts.length ? Math.max(...memoryCounts) : 0,
      total: memoryCounts.reduce((sum, value) => sum + value, 0),
    },
    structuredImpactConfidence: {
      min: confidenceValues.length ? Math.min(...confidenceValues) : 0,
      max: confidenceValues.length ? Math.max(...confidenceValues) : 0,
      values: confidenceValues,
    },
    autonomy: {
      totalSteps: turnResults.reduce(
        (sum, entry) => sum + (entry.outcome.inspector.autonomyPhase?.steps.length ?? 0),
        0,
      ),
      turnsWithFollowup: turnResults.filter(
        (entry) => (entry.outcome.inspector.autonomyPhase?.steps.length ?? 0) > 0,
      ).length,
      stepSequences: autonomyStepSequences,
    },
    datasetExportedAt: finalWorld.datasetExportedAt,
    exportPaths: finalWorld.exportPaths,
    exportedKinds,
    resolved: finalWorld.resolution.resolved,
    resolutionType: finalWorld.resolution.resolutionType,
    sacrificedLabel: finalWorld.resolution.sacrificedLabel,
    finalRound: finalWorld.round.currentRound,
    requestStats: {
      totalRequestCount: 1 + turnResults.length,
      totalTurnDurationMs: requestDurations.reduce((sum, value) => sum + value, 0),
      averageTurnRequestMs: average(requestDurations),
      maxTurnRequestMs: requestDurations.length ? Math.max(...requestDurations) : 0,
      totalRetries,
    },
    turnDetails: turnResults.map((entry, index) => ({
      turnNumber: index + 1,
      npcId: entry.turn.npcId,
      targetNpcId: entry.outcome.inspector.targetNpcId,
      selectedAction: entry.outcome.inspector.selectedAction.type,
      impactTags: entry.outcome.inspector.structuredImpact.impactTags,
      rationale: entry.outcome.inspector.structuredImpact.rationale,
      pressureDelta: totalPressureDelta(entry.outcome.pressureChanges),
      durationMs: entry.requestMetrics.durationMs,
      attempts: entry.requestMetrics.attempts,
      retried: entry.requestMetrics.retried,
    })),
  };
}

function includesAny(haystacks, needles) {
  return needles.some((needle) =>
    haystacks.some((value) => String(value ?? "").includes(needle)),
  );
}

function includesAllCombined(haystacks, needles) {
  const combined = haystacks.map((value) => String(value ?? "")).join("\n");
  return needles.every((needle) => combined.includes(needle));
}

function evaluateExpectations(actual, expectations) {
  const failures = [];
  const passed = [];
  const warnings = [];

  if (!expectations || Object.keys(expectations).length === 0) {
    warnings.push("No expectations were defined for this case.");
  }

  const unknownKeys = Object.keys(expectations).filter(
    (key) => !knownExpectationKeys.has(key),
  );

  if (unknownKeys.length > 0) {
    warnings.push(`Unknown expectation keys: ${unknownKeys.join(", ")}`);
  }

  if (expectations.mustMovePressure === true) {
    if (actual.pressureMovement.total > 0) {
      passed.push(`pressure moved (${actual.pressureMovement.total})`);
    } else {
      failures.push("Pressure did not move.");
    }
  }

  if (expectations.expectedTargetNpcId) {
    if (actual.targetNpcIds.includes(expectations.expectedTargetNpcId)) {
      passed.push(`target matched ${expectations.expectedTargetNpcId}`);
    } else {
      failures.push(
        `Expected target ${expectations.expectedTargetNpcId}, got ${actual.targetNpcIds.join(",") || "none"}.`,
      );
    }
  }

  if (Array.isArray(expectations.expectedImpactTagsAnyOf)) {
    const matched = expectations.expectedImpactTagsAnyOf.filter((tag) =>
      actual.impactTags.includes(tag),
    );

    if (matched.length > 0) {
      passed.push(`impact tag matched anyOf (${matched.join(", ")})`);
    } else {
      failures.push(
        `Expected one of impact tags ${expectations.expectedImpactTagsAnyOf.join(", ")}, got ${actual.impactTags.join(",") || "none"}.`,
      );
    }
  }

  if (Array.isArray(expectations.expectedImpactTagsAllOf)) {
    const missing = expectations.expectedImpactTagsAllOf.filter(
      (tag) => !actual.impactTags.includes(tag),
    );

    if (missing.length === 0) {
      passed.push(`impact tags include allOf (${expectations.expectedImpactTagsAllOf.join(", ")})`);
    } else {
      failures.push(`Missing impact tags: ${missing.join(", ")}.`);
    }
  }

  if (typeof expectations.minKnowledgeRetrieved === "number") {
    if (actual.knowledgeRetrieved.max >= expectations.minKnowledgeRetrieved) {
      passed.push(`knowledge max=${actual.knowledgeRetrieved.max}`);
    } else {
      failures.push(
        `Expected retrievedKnowledge >= ${expectations.minKnowledgeRetrieved}, got ${actual.knowledgeRetrieved.max}.`,
      );
    }
  }

  if (typeof expectations.minMemoriesRetrieved === "number") {
    if (actual.memoriesRetrieved.max >= expectations.minMemoriesRetrieved) {
      passed.push(`memories max=${actual.memoriesRetrieved.max}`);
    } else {
      failures.push(
        `Expected retrievedMemories >= ${expectations.minMemoriesRetrieved}, got ${actual.memoriesRetrieved.max}.`,
      );
    }
  }

  if (typeof expectations.mustResolveByRound === "number") {
    if (actual.resolved && actual.finalRound <= expectations.mustResolveByRound) {
      passed.push(`resolved by round ${actual.finalRound}`);
    } else {
      failures.push(
        `Expected resolution by round ${expectations.mustResolveByRound}, got resolved=${actual.resolved} round=${actual.finalRound}.`,
      );
    }
  }

  if (typeof expectations.expectedResolutionType === "string") {
    if (actual.resolutionType === expectations.expectedResolutionType) {
      passed.push(`resolution type matched ${actual.resolutionType}`);
    } else {
      failures.push(
        `Expected resolutionType ${expectations.expectedResolutionType}, got ${actual.resolutionType ?? "none"}.`,
      );
    }
  }

  if (Array.isArray(expectations.expectedSelectedActionAnyOf)) {
    const matched = expectations.expectedSelectedActionAnyOf.filter((value) =>
      actual.selectedActions.includes(value),
    );

    if (matched.length > 0) {
      passed.push(`selectedAction matched anyOf (${matched.join(", ")})`);
    } else {
      failures.push(
        `Expected one of selected actions ${expectations.expectedSelectedActionAnyOf.join(", ")}, got ${actual.selectedActions.join(",") || "none"}.`,
      );
    }
  }

  if (Array.isArray(expectations.expectedSelectedActionAllOf)) {
    const missing = expectations.expectedSelectedActionAllOf.filter(
      (value) => !actual.selectedActions.includes(value),
    );

    if (missing.length === 0) {
      passed.push(`selectedAction matched allOf (${expectations.expectedSelectedActionAllOf.join(", ")})`);
    } else {
      failures.push(`Missing selectedAction values: ${missing.join(", ")}.`);
    }
  }

  if (Array.isArray(expectations.rationaleIncludesAnyOf)) {
    if (includesAny(actual.impactRationales, expectations.rationaleIncludesAnyOf)) {
      passed.push("impact rationale matched anyOf");
    } else {
      failures.push(
        `Expected rationale to include one of ${expectations.rationaleIncludesAnyOf.join(", ")}.`,
      );
    }
  }

  if (Array.isArray(expectations.rationaleIncludesAllOf)) {
    if (includesAllCombined(actual.impactRationales, expectations.rationaleIncludesAllOf)) {
      passed.push("impact rationale matched allOf");
    } else {
      failures.push(
        `Expected rationale to include all of ${expectations.rationaleIncludesAllOf.join(", ")}.`,
      );
    }
  }

  if (expectations.mustExportDataset === true) {
    if (actual.datasetExportedAt && actual.exportedKinds.length > 0) {
      passed.push(`dataset exported (${actual.exportedKinds.join(", ")})`);
    } else {
      failures.push("Expected dataset export, but export paths were missing.");
    }
  }

  if (Array.isArray(expectations.expectedExportPathKindsAllOf)) {
    const missing = expectations.expectedExportPathKindsAllOf.filter(
      (kind) => !actual.exportedKinds.includes(kind),
    );

    if (missing.length === 0) {
      passed.push(`export paths include allOf (${expectations.expectedExportPathKindsAllOf.join(", ")})`);
    } else {
      failures.push(`Missing export path kinds: ${missing.join(", ")}.`);
    }
  }

  return { failures, passed, warnings };
}

async function executeReset(baseUrl, requestPolicy, instanceId) {
  const result = await retryOperation({
    operationLabel: "reset",
    maxRetries: requestPolicy.resetRetryCount,
    retryDelayMs: requestPolicy.retryDelayMs,
    shouldRetry: isTransientRequestError,
    task: () =>
      resetWorldWithMetrics(baseUrl, {
        timeoutMs: requestPolicy.timeoutMs,
        instanceId,
      }),
  });

  return {
    world: result.payload,
    requestMetrics: {
      ...result.requestMetrics,
      attempts: result.retry.attempts,
      retried: result.retry.retried,
      retryErrors: result.retry.errors,
    },
  };
}

async function executeTurn(baseUrl, turn, requestPolicy, turnNumber, instanceId) {
  const result = await retryOperation({
    operationLabel: `turn ${turnNumber}`,
    maxRetries: requestPolicy.turnRetryCount,
    retryDelayMs: requestPolicy.retryDelayMs,
    shouldRetry: isTransientRequestError,
    task: () =>
      postTurnWithMetrics(baseUrl, turn, {
        timeoutMs: requestPolicy.timeoutMs,
        instanceId,
      }),
  });

  return {
    outcome: result.payload,
    requestMetrics: {
      ...result.requestMetrics,
      attempts: result.retry.attempts,
      retried: result.retry.retried,
      retryErrors: result.retry.errors,
    },
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (getBooleanOption(args, "help", false)) {
    usage();
    return;
  }

  const baseUrl = getStringOption(args, "base-url", DEFAULT_BASE_URL);
  const casesPath = getStringOption(args, "cases");
  const outputPath = getStringOption(args, "output");
  const failFast = getBooleanOption(args, "fail-fast", false);
  const verbose = getBooleanOption(args, "verbose", false);
  const caseIdOption = getStringOption(args, "case-id");
  const instancePrefix = getStringOption(args, "instance-prefix", "replay");
  const requestPolicy = {
    timeoutMs: getNumberOption(args, "timeout-ms", 120000),
    resetRetryCount: getNumberOption(args, "reset-retry-count", 1),
    turnRetryCount: getNumberOption(args, "turn-retry-count", 0),
    retryDelayMs: getNumberOption(args, "retry-delay-ms", 1000),
  };

  assertNonNegativeInteger("--timeout-ms", requestPolicy.timeoutMs);
  assertNonNegativeInteger("--reset-retry-count", requestPolicy.resetRetryCount);
  assertNonNegativeInteger("--turn-retry-count", requestPolicy.turnRetryCount);
  assertNonNegativeInteger("--retry-delay-ms", requestPolicy.retryDelayMs);

  if (!casesPath) {
    throw new Error("--cases is required");
  }

  if (requestPolicy.turnRetryCount > 0) {
    console.error(
      "warning: --turn-retry-count can duplicate stateful interact turns if the server completed before the client timed out.",
    );
  }

  const selectedIds = caseIdOption
    ? new Set(parseCommaSeparatedOption(caseIdOption))
    : null;
  const loadedCases = await loadCases(casesPath);
  const cases = selectedIds
    ? loadedCases.filter((entry) => selectedIds.has(entry.id))
    : loadedCases;

  if (cases.length === 0) {
    throw new Error(`No cases matched in ${basenameLabel(casesPath)}`);
  }

  if (outputPath) {
    await initializeOutputFile(outputPath);
  }

  const results = [];

  for (const evalCase of cases) {
    const instanceId = buildInstanceId({
      prefix: instancePrefix,
      label: evalCase.id,
      ordinal: results.length + 1,
    });

    try {
      const resetResult = await executeReset(baseUrl, requestPolicy, instanceId);
      const turnResults = [];

      if (verbose) {
        console.log(
          `case=${evalCase.id} instance=${instanceId} reset=${resetResult.world.episodeId} resetMs=${resetResult.requestMetrics.durationMs} attempts=${resetResult.requestMetrics.attempts}`,
        );
      }

      for (const [turnIndex, turn] of evalCase.turns.entries()) {
        const turnResult = await executeTurn(
          baseUrl,
          turn,
          requestPolicy,
          turnIndex + 1,
          instanceId,
        );
        turnResults.push({
          turn,
          outcome: turnResult.outcome,
          requestMetrics: turnResult.requestMetrics,
        });

        if (verbose) {
          console.log(
            [
              `case=${evalCase.id}`,
              `turn=${turnIndex + 1}`,
              `target=${turnResult.outcome.inspector.targetNpcId ?? "none"}`,
              `selected=${turnResult.outcome.inspector.selectedAction.type}`,
              `tags=${turnResult.outcome.inspector.structuredImpact.impactTags.join(",") || "none"}`,
              `pressure=${totalPressureDelta(turnResult.outcome.pressureChanges)}`,
              `knowledge=${turnResult.outcome.inspector.retrievedKnowledge.length}`,
              `memories=${turnResult.outcome.inspector.retrievedMemories.length}`,
              `ms=${turnResult.requestMetrics.durationMs}`,
              `attempts=${turnResult.requestMetrics.attempts}`,
            ].join(" "),
          );
        }

        if (turnResult.outcome.world.resolution.resolved) {
          break;
        }
      }

      const actual = buildActualMetrics(resetResult.world, turnResults);
      const evaluation = evaluateExpectations(actual, evalCase.expectations);
      const status =
        evaluation.failures.length > 0
          ? "fail"
          : evaluation.warnings.length > 0
            ? "warning"
            : "pass";
      const result = {
        caseId: evalCase.id,
        instanceId,
        description: evalCase.description,
        status,
        sourceFile: basename(casesPath),
        requestPolicy,
        resetRequest: resetResult.requestMetrics,
        actual,
        expectations: evalCase.expectations,
        passedChecks: evaluation.passed,
        failureReasons: evaluation.failures,
        warnings: evaluation.warnings,
      };
      results.push(result);

      console.log(
        [
          `case=${result.caseId}`,
          `instance=${instanceId}`,
          `status=${result.status}`,
          `target=${actual.targetNpcIds.join(",") || "none"}`,
          `impactTags=${actual.impactTags.join(",") || "none"}`,
          `selected=${actual.selectedActions.join(",") || "none"}`,
          `pressure=${actual.pressureMovement.total}`,
          `knowledgeMax=${actual.knowledgeRetrieved.max}`,
          `exported=${actual.exportedKinds.join(",") || "none"}`,
          `failure=${result.failureReasons[0] ?? "none"}`,
        ].join(" "),
      );

      if (outputPath) {
        await appendJsonLine(outputPath, result);
      }

      if (failFast && status === "fail") {
        break;
      }
    } catch (error) {
      const failure = {
        caseId: evalCase.id,
        instanceId,
        description: evalCase.description,
        status: "fail",
        sourceFile: basename(casesPath),
        actual: null,
        expectations: evalCase.expectations,
        passedChecks: [],
        failureReasons: [errorMessage(error)],
        warnings: [],
      };
      results.push(failure);
      console.error(`case=${evalCase.id} status=fail failure=${failure.failureReasons[0]}`);

      if (outputPath) {
        await appendJsonLine(outputPath, failure);
      }

      if (failFast) {
        break;
      }
    }
  }

  const failedCount = results.filter((entry) => entry.status === "fail").length;
  const warningCount = results.filter((entry) => entry.status === "warning").length;
  console.log(
    `summary total=${results.length} failed=${failedCount} warnings=${warningCount} output=${outputPath ?? "stdout-only"}`,
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
