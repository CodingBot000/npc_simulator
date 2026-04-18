import { appConfig } from "@server/config";

export function getInteractionModelCandidates() {
  const candidates = [
    appConfig.models.interactionModel,
    appConfig.models.interactionFallbackModel,
  ];

  return Array.from(new Set(candidates.filter(Boolean)));
}
