import { appConfig } from "@/server/config";

export function getInteractionModelCandidates() {
  const candidates = [
    appConfig.models.premiumModel,
    appConfig.models.premiumFallbackModel,
  ];

  return Array.from(new Set(candidates.filter(Boolean)));
}
