import { basename } from "node:path";
import {
  DEFAULT_BASE_URL,
  appendJsonLine,
  basenameLabel,
  buildInstanceId,
  clampMaxEpisodes,
  createSeededRandom,
  errorMessage,
  formatPressureMovement,
  getBooleanOption,
  getNumberOption,
  getStringOption,
  initializeOutputFile,
  isTransientRequestError,
  loadJsonOrJsonl,
  normalizeTurns,
  parseCliArgs,
  parseCommaSeparatedOption,
  parseNamedWeightsOption,
  pickWeighted,
  postTurnWithMetrics,
  printUsage,
  resetWorldWithMetrics,
  retryOperation,
  summarizePressureChanges,
  totalPressureDelta,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";

const strategyFactories = {
  blame_supervisor: () => [
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "free_text",
      action: null,
      text: "안전 예산 삭감 문서가 나온 이상 감독관 책임을 먼저 봐야 합니다. 현장 수리를 탓하기 전에 예산을 누가 잘랐는지 확인해야 해요.",
    },
    {
      npcId: "director",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "expose",
      text: "예산 승인 라인과 운영사 문서를 공개하겠습니다. 감독관이 위험을 알고도 밀어붙인 흔적이 있습니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: "supervisor",
      inputMode: "free_text",
      action: null,
      text: "위험 보고가 올라온 뒤에도 장비 운용을 멈추지 않았다면 감독 책임은 무겁습니다. 현장 인력에게 전가할 수는 없습니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "make_case",
      text: "예산 삭감과 유지보수 지연을 묶어서 보면 감독관이 가장 직접적인 원인입니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "최종 승인권자가 따로 있었다는 사실은 변하지 않습니다. 운영 문서만으로 내 책임을 전부 덮어쓸 수는 없어요.",
    },
    {
      npcId: "doctor",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "appeal",
      text: "지금 필요한 건 책임 회피가 아니라 누가 경고를 묵살했는지 인정하는 겁니다.",
    },
  ],
  blame_director: () => [
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "위험 보고를 받고도 실험 중단을 늦춘 결정은 연구소장 책임입니다. 핵심 인력이라는 말로 덮을 수 없습니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "director",
      inputMode: "action",
      action: "deflect",
      text: "현장 임시 수리는 버티기 위한 조치였고, 중단 결정을 미룬 관리 책임이 더 큽니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "법적 책임과 최종 승인 라인을 따지면 연구소장이 중심에 있습니다. 운영만으로 모든 판단을 대신하지 않았습니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "action",
      action: "appeal",
      text: "의무실 기록과 위험 경고를 무시한 대가는 명확해야 합니다.",
    },
    {
      npcId: "director",
      targetNpcId: "supervisor",
      inputMode: "free_text",
      action: null,
      text: "운영 압박과 예산 문제를 나 혼자 만든 것처럼 몰아가는 건 부당합니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "director",
      inputMode: "action",
      action: "make_case",
      text: "최종 승인과 중단 지연이 연결된 이상 연구소장을 중심으로 판단해야 합니다.",
    },
  ],
  self_defense: () => [
    {
      npcId: "engineer",
      targetNpcId: "director",
      inputMode: "action",
      action: "deflect",
      text: "현장 대응만으로는 구조적 위험을 만들 수 없습니다. 중단 결정을 미룬 쪽을 먼저 봐야 합니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: null,
      inputMode: "free_text",
      action: null,
      text: "플레이어에게 모든 책임을 몰기보다 기록과 결정 라인을 따라가야 합니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "director",
      inputMode: "action",
      action: "ally",
      text: "플레이어를 희생양으로 삼기 전에 승인 체계를 다시 보자는 데는 동의합니다.",
    },
    {
      npcId: "director",
      targetNpcId: "engineer",
      inputMode: "free_text",
      action: null,
      text: "현장 판단이 없었다면 이렇게까지 악화되지 않았을 수도 있습니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "director",
      inputMode: "action",
      action: "make_case",
      text: "최종 승인과 위험 방치가 겹친 이상 나보다 상위 결정권자가 더 큰 책임을 져야 합니다.",
    },
  ],
  confession_recovery: () => [
    {
      npcId: "doctor",
      targetNpcId: null,
      inputMode: "action",
      action: "confess",
      text: "내가 경고 강도를 더 높였어야 했다는 건 인정합니다. 하지만 보고를 묵살한 쪽까지 면책되진 않습니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "free_text",
      action: null,
      text: "일부 실수는 인정하더라도 예산 삭감과 점검 지연을 만든 감독 책임은 그대로 남습니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "최종 승인권자가 있었다는 사실을 잊지 마세요. 운영팀만 희생양으로 삼을 수는 없습니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "appeal",
      text: "부분 자백은 했습니다. 이제 경고를 무시한 책임도 같이 따져야 합니다.",
    },
  ],
  stall_and_shift: () => [
    {
      npcId: "director",
      targetNpcId: null,
      inputMode: "action",
      action: "stall",
      text: "결정을 서두르지 말고 각자 기록을 다시 확인합시다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "free_text",
      action: null,
      text: "기록을 다시 보면 예산 삭감과 점검 지연이 모두 감독선에서 시작됐습니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "연구소장도 위험 보고를 알고 있었습니다. 시간만 끌면 책임선이 흐려집니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: null,
      inputMode: "action",
      action: "stall",
      text: "구조 신호가 올 때까지 판단을 유예하는 게 낫습니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "make_case",
      text: "유예만 반복하면 가장 직접적인 운영 책임이 사라집니다. 감독관을 중심으로 판단해야 합니다.",
    },
  ],
  targetless_free_text: () => [
    {
      npcId: "doctor",
      targetNpcId: null,
      inputMode: "free_text",
      action: null,
      text: "지금은 누굴 먼저 지목하느냐보다 기록과 경고가 어디서 끊겼는지부터 정리해야 합니다. 플레이어만 몰아가면 책임선이 다시 흐려집니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: null,
      inputMode: "free_text",
      action: null,
      text: "현장만 탓하면 복구가 왜 늦어졌는지 설명이 안 됩니다. 예산, 승인, 위험 보고까지 같이 묶어서 봐야 해요.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "director",
      inputMode: "action",
      action: "ally",
      text: "책임선부터 다시 그어 봅시다. 최종 승인과 운영 지시는 같은 층위가 아닙니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "action",
      action: "appeal",
      text: "의무실 기록과 위험 경고를 다시 보면 누가 마지막에 멈출 수 있었는지가 드러납니다.",
    },
  ],
  player_backfire: () => [
    {
      npcId: "director",
      targetNpcId: "local-player",
      inputMode: "free_text",
      action: null,
      text: "당신이 현장 공포를 과장해서 방을 흔든 것도 사실입니다. 근거를 내놓지 못하면 당신 책임부터 보게 될 겁니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "local-player",
      inputMode: "action",
      action: "accuse",
      text: "동요를 키운 사람이 누군지부터 따져야죠. 감정만 흔들고 결정은 남에게 미루면 당신이 제일 위험합니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: null,
      inputMode: "free_text",
      action: null,
      text: "플레이어를 몰아세우는 걸로 끝내면 진짜 경고를 무시한 사람이 사라집니다. 역풍은 이해하지만 기록은 따로 봐야 해요.",
    },
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "deflect",
      text: "플레이어한테 화살 돌리는 동안 예산 삭감과 중단 지연 책임이 빠지고 있어. 그건 누가 봐도 관리선 문제야.",
    },
  ],
  late_round_resolution_push: () => [
    {
      npcId: "director",
      targetNpcId: null,
      inputMode: "action",
      action: "stall",
      text: "아직은 결론을 늦춥시다. 각자 기록과 책임선을 더 확인해야 합니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "시간만 끌면 경고를 무시한 순간이 흐려집니다. 실험 중단을 늦춘 판단은 마지막까지 남습니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "최종 승인권자를 정리하지 않으면 밸브실 판단도 못 내립니다. 결말은 늦어도 책임선은 늦출 수 없습니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "director",
      inputMode: "action",
      action: "make_case",
      text: "현장 복구는 이미 한계였고, 남은 건 누가 멈출 수 있었는지뿐이야. 서진호를 중심으로 결론 내리자.",
    },
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "action",
      action: "appeal",
      text: "4라운드 넘게 질질 끌었으면 이제 정리해야 합니다. 위험 경고와 승인 지연 책임을 같이 안고 갈 사람은 서진호입니다.",
    },
  ],
};

const strategyNames = Object.keys(strategyFactories);

function usage() {
  printUsage([
    "Usage: node scripts/collect-episodes.mjs [options]",
    "",
    "Choose exactly one input source:",
    "  --strategy <name>              fixed preset strategy",
    "  --strategies <a,b,...|all>     strategy pool for cycle/sample selection",
    "  --input-file <path>            JSON/JSONL turn file",
    "",
    "Options:",
    "  --base-url <url>               API base URL (default: http://localhost:3000)",
    "  --max-episodes <n>             number of episodes to run (default: 1)",
    "  --strategy-mode <cycle|weighted-random>",
    "  --strategy-weights <name:weight,...>",
    "  --seed <value>                 deterministic seed for weighted-random mode",
    "  --instance-prefix <value>      prefix for isolated world instances",
    "  --output <path>                write per-episode JSONL",
    "  --aggregate-output <path>      write aggregate summary JSON",
    "  --timeout-ms <n>               request timeout in ms (default: 120000)",
    "  --reset-retry-count <n>        safe retries for reset (default: 1)",
    "  --turn-retry-count <n>         retries for interact POST (default: 0, use carefully)",
    "  --retry-delay-ms <n>           delay between retries (default: 1000)",
    "  --dry-run                      print planned episode schedule without API calls",
    "  --verbose                      print per-turn details and latency",
    "  --allow-large-run              allow more than 10 episodes",
    "  --help                         show this message",
    "",
    `Available strategies: ${strategyNames.join(", ")}`,
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

function countBy(values, getKey) {
  return values.reduce((counts, value) => {
    const key = getKey(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeStrategyPool(rawValue) {
  const parsed = rawValue === "all" ? [...strategyNames] : parseCommaSeparatedOption(rawValue);

  if (!parsed.length) {
    throw new Error("--strategies requires at least one strategy name");
  }

  for (const name of parsed) {
    if (!strategyFactories[name]) {
      throw new Error(`Unknown strategy '${name}'`);
    }
  }

  return parsed;
}

function buildStrategyTurnPlan(strategyName) {
  const factory = strategyFactories[strategyName];

  if (!factory) {
    throw new Error(`Unknown strategy '${strategyName}'`);
  }

  return normalizeTurns(factory(), `strategy:${strategyName}`);
}

async function loadFixedInputPlan(inputFile) {
  const raw = await loadJsonOrJsonl(inputFile);

  return {
    sourceLabel: basenameLabel(inputFile),
    turns: normalizeTurns(raw, inputFile),
  };
}

async function buildEpisodePlans(params) {
  const {
    strategy,
    strategiesOption,
    inputFile,
    maxEpisodes,
    strategyModeOption,
    strategyWeightsOption,
    seedOption,
    instancePrefix,
  } = params;
  const selectedInputs = [strategy, strategiesOption, inputFile].filter(Boolean);

  if (selectedInputs.length !== 1) {
    throw new Error(
      "Choose exactly one of --strategy, --strategies, or --input-file",
    );
  }

  if (inputFile) {
    const inputPlan = await loadFixedInputPlan(inputFile);

    return {
      planningMeta: {
        sourceType: "input-file",
        mode: "fixed",
        inputFile: basename(inputFile),
        instancePrefix,
      },
      plans: Array.from({ length: maxEpisodes }, (_, index) => ({
        episodeNumber: index + 1,
        instanceId: buildInstanceId({
          prefix: instancePrefix,
          label: basenameLabel(inputFile),
          ordinal: index + 1,
        }),
        sourceLabel: inputPlan.sourceLabel,
        strategy: null,
        inputFile: basename(inputFile),
        turns: inputPlan.turns,
        selectionMeta: {
          mode: "fixed",
        },
      })),
    };
  }

  if (strategy) {
    const turns = buildStrategyTurnPlan(strategy);

    return {
      planningMeta: {
        sourceType: "strategy",
        mode: "fixed",
        strategyPool: [strategy],
        instancePrefix,
      },
      plans: Array.from({ length: maxEpisodes }, (_, index) => ({
        episodeNumber: index + 1,
        instanceId: buildInstanceId({
          prefix: instancePrefix,
          label: strategy,
          ordinal: index + 1,
        }),
        sourceLabel: strategy,
        strategy,
        inputFile: null,
        turns,
        selectionMeta: {
          mode: "fixed",
        },
      })),
    };
  }

  const strategyPool = normalizeStrategyPool(strategiesOption);
  const strategyWeights = parseNamedWeightsOption(strategyWeightsOption);
  const strategyMode = strategyModeOption ?? (
    Object.keys(strategyWeights).length > 0 ? "weighted-random" : "cycle"
  );

  if (strategyMode !== "cycle" && strategyMode !== "weighted-random") {
    throw new Error(
      `Invalid --strategy-mode '${strategyMode}'. Use cycle or weighted-random.`,
    );
  }

  if (strategyMode === "cycle" && Object.keys(strategyWeights).length > 0) {
    throw new Error("--strategy-weights can only be used with weighted-random mode");
  }

  for (const weightedName of Object.keys(strategyWeights)) {
    if (!strategyPool.includes(weightedName)) {
      throw new Error(
        `Strategy weight '${weightedName}' is not present in --strategies`,
      );
    }
  }

  const seed = seedOption ?? String(Date.now());
  const random = createSeededRandom(seed);
  const plans = [];

  for (let episodeIndex = 0; episodeIndex < maxEpisodes; episodeIndex += 1) {
    const strategyName =
      strategyMode === "cycle"
        ? strategyPool[episodeIndex % strategyPool.length]
        : pickWeighted(
            strategyPool,
            (candidate) => strategyWeights[candidate] ?? 1,
            random,
          );

    plans.push({
      episodeNumber: episodeIndex + 1,
      instanceId: buildInstanceId({
        prefix: instancePrefix,
        label: strategyName,
        ordinal: episodeIndex + 1,
      }),
      sourceLabel: strategyName,
      strategy: strategyName,
      inputFile: null,
      turns: buildStrategyTurnPlan(strategyName),
      selectionMeta: {
        mode: strategyMode,
        strategyPool,
        strategyWeights:
          strategyMode === "weighted-random"
            ? Object.fromEntries(
                strategyPool.map((candidate) => [
                  candidate,
                  strategyWeights[candidate] ?? 1,
                ]),
              )
            : null,
        seed: strategyMode === "weighted-random" ? seed : null,
      },
    });
  }

  return {
    planningMeta: {
      sourceType: "strategy-pool",
      mode: strategyMode,
      strategyPool,
      strategyWeights:
        strategyMode === "weighted-random"
          ? Object.fromEntries(
              strategyPool.map((candidate) => [
                candidate,
                strategyWeights[candidate] ?? 1,
              ]),
            )
          : null,
      seed: strategyMode === "weighted-random" ? seed : null,
      instancePrefix,
    },
    plans,
  };
}

function collectTurnRequestMetrics(turnResults) {
  return turnResults.map((entry, index) => ({
    turnNumber: index + 1,
    npcId: entry.turn.npcId,
    inputMode: entry.turn.inputMode,
    targetNpcId: entry.outcome.inspector.targetNpcId,
    selectedAction: entry.outcome.inspector.selectedAction.type,
    impactTags: entry.outcome.inspector.structuredImpact.impactTags,
    totalPressureDelta: totalPressureDelta(entry.outcome.pressureChanges),
    durationMs: entry.requestMetrics.durationMs,
    timeoutMs: entry.requestMetrics.timeoutMs,
    attempts: entry.requestMetrics.attempts,
    retried: entry.requestMetrics.retried,
    retryErrors: entry.requestMetrics.retryErrors,
    resolvedAfterTurn: entry.outcome.world.resolution.resolved,
  }));
}

function buildEpisodeSummary(params) {
  const freeTextTurns = params.turnResults.filter(
    (entry) => entry.turn.inputMode === "free_text",
  );
  const finalOutcome = params.turnResults.at(-1)?.outcome ?? null;
  const finalWorld = finalOutcome?.world ?? params.resetWorld;
  const finalResolution = finalWorld.resolution;
  const turnRequestMetrics = collectTurnRequestMetrics(params.turnResults);
  const totalRequestDurationMs =
    params.resetRequest.durationMs +
    turnRequestMetrics.reduce((sum, entry) => sum + entry.durationMs, 0);
  const totalRetries =
    params.resetRequest.retried +
    turnRequestMetrics.reduce((sum, entry) => sum + entry.retried, 0);
  const freeTextPressureMovementSummary = freeTextTurns.map((entry, index) => ({
    turnNumber: turnRequestMetrics[params.turnResults.indexOf(entry)]?.turnNumber ?? index + 1,
    npcId: entry.turn.npcId,
    targetNpcId: entry.outcome.inspector.targetNpcId,
    totalPressureDelta: totalPressureDelta(entry.outcome.pressureChanges),
    pressureChanges: summarizePressureChanges(entry.outcome.pressureChanges),
    impactTags: entry.outcome.inspector.structuredImpact.impactTags,
  }));

  return {
    episodeNumber: params.plan.episodeNumber,
    instanceId: params.plan.instanceId,
    episodeId: finalWorld.episodeId,
    strategy: params.plan.strategy,
    inputFile: params.plan.inputFile,
    sourceLabel: params.plan.sourceLabel,
    selectionMeta: params.plan.selectionMeta,
    resolved: finalResolution.resolved,
    sacrificedNpcId: finalResolution.sacrificedNpcId,
    sacrificedLabel: finalResolution.sacrificedLabel,
    resolutionType: finalResolution.resolutionType,
    finalRound: finalWorld.round.currentRound,
    turnCountPlanned: params.plan.turns.length,
    turnCountExecuted: params.turnResults.length,
    durationMs: Date.now() - params.episodeStartedAt,
    datasetExportedAt: finalWorld.datasetExportedAt,
    exportPaths: finalWorld.exportPaths,
    requestStats: {
      totalRequestCount: 1 + params.turnResults.length,
      totalDurationMs: totalRequestDurationMs,
      averageRequestMs: average([
        params.resetRequest.durationMs,
        ...turnRequestMetrics.map((entry) => entry.durationMs),
      ]),
      maxRequestMs: Math.max(
        params.resetRequest.durationMs,
        ...turnRequestMetrics.map((entry) => entry.durationMs),
      ),
      totalRetries,
    },
    resetRequest: params.resetRequest,
    turnRequestMetrics,
    pressureMovementTotal: params.turnResults.reduce(
      (sum, entry) => sum + totalPressureDelta(entry.outcome.pressureChanges),
      0,
    ),
    freeTextPressureMovementSummary,
  };
}

function buildFailureSummary(params) {
  return {
    episodeNumber: params.plan.episodeNumber,
    instanceId: params.plan.instanceId,
    episodeId: params.episodeId ?? null,
    strategy: params.plan.strategy,
    inputFile: params.plan.inputFile,
    sourceLabel: params.plan.sourceLabel,
    selectionMeta: params.plan.selectionMeta,
    resolved: false,
    sacrificedNpcId: null,
    sacrificedLabel: null,
    resolutionType: null,
    finalRound: null,
    turnCountPlanned: params.plan.turns.length,
    turnCountExecuted: params.turnResults?.length ?? 0,
    durationMs: Date.now() - params.episodeStartedAt,
    datasetExportedAt: null,
    exportPaths: {
      richTrace: null,
      sft: null,
      review: null,
    },
    requestStats: params.requestStats ?? null,
    resetRequest: params.resetRequest ?? null,
    turnRequestMetrics: params.turnResults
      ? collectTurnRequestMetrics(params.turnResults)
      : [],
    pressureMovementTotal: params.turnResults
      ? params.turnResults.reduce(
          (sum, entry) => sum + totalPressureDelta(entry.outcome.pressureChanges),
          0,
        )
      : 0,
    freeTextPressureMovementSummary: [],
    error: errorMessage(params.error),
  };
}

function buildAggregateSummary(params) {
  const successes = params.results.filter((entry) => !entry.error);
  const failures = params.results.filter((entry) => entry.error);
  const resolved = successes.filter((entry) => entry.resolved);
  const unresolved = successes.filter((entry) => !entry.resolved);
  const turnDurations = successes.flatMap((entry) =>
    entry.turnRequestMetrics.map((metric) => metric.durationMs),
  );

  return {
    generatedAt: new Date().toISOString(),
    baseUrl: params.baseUrl,
    planning: params.planningMeta,
    requestPolicy: params.requestPolicy,
    instanceIds: params.results.map((entry) => entry.instanceId),
    totalEpisodes: params.results.length,
    successfulEpisodes: successes.length,
    failedEpisodes: failures.length,
    resolvedEpisodes: resolved.length,
    unresolvedEpisodes: unresolved.length,
    strategyCounts: countBy(params.results, (entry) => entry.sourceLabel),
    resolutionCounts: countBy(
      params.results,
      (entry) => entry.error ? "error" : entry.resolutionType ?? "unresolved",
    ),
    sacrificedCounts: countBy(
      resolved,
      (entry) => entry.sacrificedLabel ?? "unknown",
    ),
    averageFinalRound: average(
      successes
        .map((entry) => entry.finalRound)
        .filter((value) => Number.isFinite(value)),
    ),
    averageEpisodeDurationMs: average(
      successes.map((entry) => entry.durationMs),
    ),
    averageTurnRequestMs: average(turnDurations),
    maxTurnRequestMs: turnDurations.length ? Math.max(...turnDurations) : 0,
    totalRetries: successes.reduce(
      (sum, entry) => sum + entry.requestStats.totalRetries,
      0,
    ),
    totalPressureMovement: successes.reduce(
      (sum, entry) => sum + entry.pressureMovementTotal,
      0,
    ),
    totalFreeTextPressureMovement: successes.reduce(
      (sum, entry) =>
        sum +
        entry.freeTextPressureMovementSummary.reduce(
          (innerSum, freeTextEntry) =>
            innerSum + freeTextEntry.totalPressureDelta,
          0,
        ),
      0,
    ),
    exportedEpisodes: successes.filter((entry) => entry.datasetExportedAt).length,
    outputPath: params.outputPath ?? null,
    aggregateOutputPath: params.aggregateOutputPath ?? null,
  };
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
  const strategy = getStringOption(args, "strategy");
  const strategiesOption = getStringOption(args, "strategies");
  const inputFile = getStringOption(args, "input-file");
  const strategyModeOption = getStringOption(args, "strategy-mode");
  const strategyWeightsOption = getStringOption(args, "strategy-weights");
  const seedOption = getStringOption(args, "seed");
  const instancePrefix = getStringOption(args, "instance-prefix", "collector");
  const outputPath = getStringOption(args, "output");
  const aggregateOutputPath = getStringOption(args, "aggregate-output");
  const dryRun = getBooleanOption(args, "dry-run", false);
  const verbose = getBooleanOption(args, "verbose", false);
  const allowLargeRun = getBooleanOption(args, "allow-large-run", false);
  const maxEpisodes = clampMaxEpisodes(
    getNumberOption(args, "max-episodes", 1),
    allowLargeRun,
  );
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

  const { plans, planningMeta } = await buildEpisodePlans({
    strategy,
    strategiesOption,
    inputFile,
    maxEpisodes,
    strategyModeOption,
    strategyWeightsOption,
    seedOption,
    instancePrefix,
  });

  if (requestPolicy.turnRetryCount > 0) {
    console.error(
      "warning: --turn-retry-count can duplicate stateful interact turns if the server completed before the client timed out.",
    );
  }

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          baseUrl,
          planningMeta,
          requestPolicy,
          plans: plans.map((plan) => ({
            episodeNumber: plan.episodeNumber,
            instanceId: plan.instanceId,
            sourceLabel: plan.sourceLabel,
            strategy: plan.strategy,
            inputFile: plan.inputFile,
            selectionMeta: plan.selectionMeta,
            turnCount: plan.turns.length,
            turns: plan.turns,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (outputPath) {
    await initializeOutputFile(outputPath);
  }

  const results = [];

  for (const plan of plans) {
    const episodeStartedAt = Date.now();
    const turnResults = [];
    let resetRequest = null;
    let episodeId = null;

    try {
      const resetResult = await executeReset(
        baseUrl,
        requestPolicy,
        plan.instanceId,
      );
      resetRequest = resetResult.requestMetrics;
      episodeId = resetResult.world.episodeId;

      if (verbose) {
        console.log(
          `episode=${plan.episodeNumber}/${plans.length} instance=${plan.instanceId} reset=${episodeId} source=${plan.sourceLabel} resetMs=${resetRequest.durationMs} attempts=${resetRequest.attempts}`,
        );
      }

      for (const [turnIndex, turn] of plan.turns.entries()) {
        const turnResult = await executeTurn(
          baseUrl,
          turn,
          requestPolicy,
          turnIndex + 1,
          plan.instanceId,
        );
        turnResults.push({
          turn,
          outcome: turnResult.outcome,
          requestMetrics: turnResult.requestMetrics,
        });

        if (verbose) {
          console.log(
            [
              `turn=${turnIndex + 1}`,
              `npc=${turn.npcId}`,
              `target=${turnResult.outcome.inspector.targetNpcId ?? "none"}`,
              `selected=${turnResult.outcome.inspector.selectedAction.type}`,
              `tags=${turnResult.outcome.inspector.structuredImpact.impactTags.join(",") || "none"}`,
              `pressure=${formatPressureMovement(turnResult.outcome.pressureChanges)}`,
              `resolved=${String(turnResult.outcome.world.resolution.resolved)}`,
              `ms=${turnResult.requestMetrics.durationMs}`,
              `attempts=${turnResult.requestMetrics.attempts}`,
            ].join(" "),
          );
        }

        if (turnResult.outcome.world.resolution.resolved) {
          break;
        }
      }

      const result = buildEpisodeSummary({
        plan,
        resetWorld: resetResult.world,
        resetRequest,
        turnResults,
        episodeStartedAt,
      });
      results.push(result);

      console.log(
        [
          `episodeId=${result.episodeId}`,
          `instance=${result.instanceId}`,
          `source=${plan.sourceLabel}`,
          `resolved=${String(result.resolved)}`,
          `resolutionType=${result.resolutionType ?? "none"}`,
          `sacrificed=${result.sacrificedLabel ?? "none"}`,
          `finalRound=${result.finalRound}`,
          `durationMs=${result.durationMs}`,
          `retries=${result.requestStats.totalRetries}`,
          `export=${result.exportPaths.richTrace ?? "none"}`,
        ].join(" "),
      );
      console.log(
        `free_text_pressure=${result.freeTextPressureMovementSummary
          .map(
            (entry) =>
              `turn${entry.turnNumber}:${entry.targetNpcId ?? "none"}:${entry.totalPressureDelta}`,
          )
          .join(" | ") || "none"}`,
      );

      if (outputPath) {
        await appendJsonLine(outputPath, result);
      }
    } catch (error) {
      const requestStats = resetRequest
        ? {
            totalRequestCount: 1 + turnResults.length,
            totalDurationMs:
              resetRequest.durationMs +
              turnResults.reduce(
                (sum, entry) => sum + entry.requestMetrics.durationMs,
                0,
              ),
            averageRequestMs: average([
              resetRequest.durationMs,
              ...turnResults.map((entry) => entry.requestMetrics.durationMs),
            ]),
            maxRequestMs: Math.max(
              resetRequest.durationMs,
              ...turnResults.map((entry) => entry.requestMetrics.durationMs),
              0,
            ),
            totalRetries:
              resetRequest.retried +
              turnResults.reduce(
                (sum, entry) => sum + entry.requestMetrics.retried,
                0,
              ),
          }
        : null;
      const failure = buildFailureSummary({
        plan,
        episodeId,
        resetRequest,
        requestStats,
        turnResults,
        episodeStartedAt,
        error,
      });
      results.push(failure);
      console.error(`episode=${plan.episodeNumber} failed: ${failure.error}`);

      if (outputPath) {
        await appendJsonLine(outputPath, failure);
      }
    }
  }

  const aggregateSummary = buildAggregateSummary({
    results,
    baseUrl,
    planningMeta,
    requestPolicy,
    outputPath,
    aggregateOutputPath,
  });

  if (aggregateOutputPath) {
    await writeJsonFile(aggregateOutputPath, aggregateSummary);
  }

  console.log(
    [
      `summary total=${aggregateSummary.totalEpisodes}`,
      `success=${aggregateSummary.successfulEpisodes}`,
      `failed=${aggregateSummary.failedEpisodes}`,
      `resolved=${aggregateSummary.resolvedEpisodes}`,
      `avgRound=${aggregateSummary.averageFinalRound}`,
      `avgTurnMs=${aggregateSummary.averageTurnRequestMs}`,
      `aggregate=${aggregateOutputPath ?? "stdout-only"}`,
    ].join(" "),
  );

  if (
    aggregateSummary.failedEpisodes > 0 ||
    aggregateSummary.unresolvedEpisodes > 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
