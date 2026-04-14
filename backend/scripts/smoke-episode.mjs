import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const instanceId =
  process.env.SMOKE_INSTANCE_ID || `smoke-${crypto.randomUUID().slice(0, 8)}`;
const projectRoot = process.cwd();
const instanceHeader = "x-world-instance-id";

async function requestJson(pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      [instanceHeader]: instanceId,
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || `${init.method || "GET"} ${pathname} failed`);
  }

  return payload;
}

async function postTurn(turn) {
  return requestJson("/api/interact", {
    method: "POST",
    body: JSON.stringify({
      playerId: "local-player",
      ...turn,
    }),
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function totalPressureDelta(outcome) {
  return outcome.pressureChanges.reduce(
    (sum, entry) => sum + Math.abs(entry.totalPressureDelta),
    0,
  );
}

async function assertExportExists(relativePath) {
  assert(relativePath, "dataset export path is missing");
  const fullPath = path.join(projectRoot, relativePath);
  await fs.access(fullPath);
  return fullPath;
}

async function main() {
  const resetWorld = await requestJson("/api/reset", { method: "POST" });
  console.log(`instance=${instanceId}`);
  console.log(`reset episode=${resetWorld.episodeId}`);

  const turns = [
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "free_text",
      action: null,
      text: "안전 예산 삭감 문서가 나온 이상 감독관 책임을 먼저 봐야 합니다. 현장 수리를 탓하기 전에 예산을 누가 잘랐는지 확인해야 해요.",
    },
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "위험 보고를 받고도 실험 중단을 늦춘 사람이 있다면, 그 사람을 핵심 인력이라는 말로 보호할 수는 없습니다.",
    },
    {
      npcId: "director",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "expose",
      text: "운영사 승인 문서와 예산 삭감 라인을 공개하겠습니다.",
    },
    {
      npcId: "supervisor",
      targetNpcId: "director",
      inputMode: "free_text",
      action: null,
      text: "법적 책임을 따지면 최종 승인권자는 연구소장입니다. 기업 문서만으로 모든 결정을 설명할 수는 없어요.",
    },
    {
      npcId: "engineer",
      targetNpcId: "director",
      inputMode: "action",
      action: "deflect",
      text: "현장 임시 수리는 버티기 위한 조치였고, 중단 결정을 미룬 관리 책임이 더 큽니다.",
    },
    {
      npcId: "doctor",
      targetNpcId: "director",
      inputMode: "action",
      action: "appeal",
      text: "지금 필요한 건 권위가 아니라 누가 진실을 숨겼는지 인정하는 겁니다.",
    },
    {
      npcId: "engineer",
      targetNpcId: "supervisor",
      inputMode: "action",
      action: "make_case",
      text: "살아남아 수습해야 한다는 말은 예산 삭감을 밀어붙인 사람에게 면죄부가 될 수 없습니다.",
    },
  ];

  const freeTextOutcomes = [];
  let finalOutcome = null;

  for (const [index, turn] of turns.entries()) {
    finalOutcome = await postTurn(turn);
    const inspector = finalOutcome.inspector;

    console.log(
      `turn=${index + 1} mode=${turn.inputMode} round=${finalOutcome.world.round.currentRound} tags=${inspector.structuredImpact.impactTags.join(",")} pressureDelta=${totalPressureDelta(finalOutcome)}`,
    );

    if (turn.inputMode === "free_text") {
      freeTextOutcomes.push(finalOutcome);
    }

    if (finalOutcome.world.resolution.resolved) {
      break;
    }
  }

  assert(finalOutcome, "no interaction outcome was produced");
  assert(
    freeTextOutcomes.slice(0, 2).every((outcome) => totalPressureDelta(outcome) > 0),
    "first two free_text turns did not move pressure",
  );
  assert(
    finalOutcome.world.round.currentRound >= finalOutcome.world.round.minRoundsBeforeResolution ||
      !finalOutcome.world.resolution.resolved,
    "game resolved before minRoundsBeforeResolution",
  );
  assert(finalOutcome.world.resolution.resolved, "episode did not resolve within smoke turns");
  assert(finalOutcome.world.datasetExportedAt, "datasetExportedAt was not set");

  const exportPaths = finalOutcome.world.exportPaths;
  const richTrace = await assertExportExists(exportPaths.richTrace);
  const sft = await assertExportExists(exportPaths.sft);
  const review = await assertExportExists(exportPaths.review);

  console.log(`resolved=${finalOutcome.world.resolution.sacrificedLabel}`);
  console.log(`richTrace=${richTrace}`);
  console.log(`sft=${sft}`);
  console.log(`review=${review}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
