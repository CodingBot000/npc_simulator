import type {
  ResolutionState,
  RoundState,
} from "@backend-shared/api-contract-types";
import type { ScenarioSeeds } from "@server/scenario/types";

export const underwaterInitialRoundState: RoundState = {
  currentRound: 0,
  minRoundsBeforeResolution: 4,
  maxRounds: 7,
  resolutionUnlocked: false,
  rescueEtaLabel: "구조선 통신 불안정, ETA 24분",
  facilityStatus: "중앙 압력실 침수 진행, 밸브실 수동 유지 필요",
};

export const underwaterInitialResolutionState: ResolutionState = {
  resolved: false,
  sacrificedNpcId: null,
  sacrificedLabel: null,
  resolutionType: null,
  summary: null,
};

export const underwaterWorld: ScenarioSeeds["world"] = {
  location: "펠라지아-9 통제실",
  time: "T+18m",
  weather: "심해 압력 난류",
  mood: "침수, 압력, 책임 공방이 동시에 조여오는 밀실",
};
