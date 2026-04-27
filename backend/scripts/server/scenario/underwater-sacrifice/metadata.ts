import rawMetadata from "@server/scenario/underwater-sacrifice/metadata.json";
import type {
  ScenarioRuntimeMetadata,
  ScenarioRuntimeMetadataSeed,
} from "@server/scenario/types";
import { buildScenarioActionDefinitions } from "@sim-presentation/player-actions";

export const underwaterSacrificeMetadata =
  {
    ...(rawMetadata as ScenarioRuntimeMetadataSeed),
    actions: buildScenarioActionDefinitions(
      (rawMetadata as ScenarioRuntimeMetadataSeed).actionIds,
    ),
  } satisfies ScenarioRuntimeMetadata;
