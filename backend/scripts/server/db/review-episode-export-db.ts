import { withDbTransaction } from "@server/db/postgres";
import {
  type RawRecord,
  asBoolean,
  asNumber,
  asObject,
  asString,
  jsonParam,
} from "@server/db/review-db-core";

export async function upsertEpisodeExportToDb(params: {
  worldState: RawRecord;
  turns: RawRecord[];
  exportedAt: string;
  exportPaths: {
    richTrace: string;
    sft: string;
    review: string;
  };
}) {
  await withDbTransaction(async (client) => {
    const episodeUid = asString(params.worldState.episodeId);
    if (!episodeUid) {
      return;
    }

    const existingEpisodeResult = await client.query<{ id: number }>(
      "SELECT id FROM npc_episode WHERE episode_uid = $1 ORDER BY id DESC LIMIT 1",
      [episodeUid],
    );
    let episodeId = existingEpisodeResult.rows[0]?.id ?? null;

    if (episodeId) {
      await client.query(
        `UPDATE npc_episode
            SET scenario_id = $2,
                started_at = $3,
                ended_at = $4,
                exported_at = $5,
                resolved = $6,
                resolution_type = $7,
                sacrificed_npc_id = $8,
                sacrificed_label = $9,
                final_round = $10,
                final_state_json = $11,
                export_paths_json = $12,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [
          episodeId,
          asString(params.worldState.scenarioId),
          asString(params.worldState.startedAt),
          asString(params.worldState.endedAt),
          params.exportedAt,
          asBoolean(asObject(params.worldState.resolution).resolved),
          asString(asObject(params.worldState.resolution).resolutionType),
          asString(asObject(params.worldState.resolution).sacrificedNpcId),
          asString(asObject(params.worldState.resolution).sacrificedLabel),
          asNumber(asObject(params.worldState.round).currentRound),
          jsonParam(params.worldState),
          jsonParam(params.exportPaths),
        ],
      );
      await client.query("DELETE FROM npc_episode_turn WHERE episode_id = $1", [episodeId]);
    } else {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO npc_episode (
            episode_uid,
            scenario_id,
            started_at,
            ended_at,
            exported_at,
            resolved,
            resolution_type,
            sacrificed_npc_id,
            sacrificed_label,
            final_round,
            final_state_json,
            export_paths_json,
            source_file_path
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          RETURNING id`,
        [
          episodeUid,
          asString(params.worldState.scenarioId),
          asString(params.worldState.startedAt),
          asString(params.worldState.endedAt),
          params.exportedAt,
          asBoolean(asObject(params.worldState.resolution).resolved),
          asString(asObject(params.worldState.resolution).resolutionType),
          asString(asObject(params.worldState.resolution).sacrificedNpcId),
          asString(asObject(params.worldState.resolution).sacrificedLabel),
          asNumber(asObject(params.worldState.round).currentRound),
          jsonParam(params.worldState),
          jsonParam(params.exportPaths),
          params.exportPaths.richTrace,
        ],
      );
      episodeId = inserted.rows[0].id;
    }

    for (const turn of params.turns) {
      await client.query(
        `INSERT INTO npc_episode_turn (
            episode_id,
            turn_index,
            round_before,
            round_after,
            npc_id,
            target_npc_id,
            input_mode,
            action_name,
            raw_player_text,
            normalized_input_summary,
            prompt_context_summary,
            prompt_bundle_json,
            assistant_output_json,
            state_impact_json,
            provider_mode,
            interaction_model,
            fallback_model,
            reply_adapter_mode,
            reply_adapter_applied,
            deterministic_fallback_used,
            generation_meta_json
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
          )`,
        [
          episodeId,
          asNumber(turn.turnIndex),
          asNumber(turn.roundBefore),
          asNumber(turn.roundAfter),
          asString(turn.npcId),
          asString(turn.targetNpcId),
          asString(turn.inputMode),
          asString(turn.action),
          asString(turn.rawPlayerText),
          asString(turn.normalizedInputSummary),
          asString(turn.llmPromptContextSummary),
          jsonParam({
            episodeId,
            scenarioId: asString(params.worldState.scenarioId),
            turnIndex: asNumber(turn.turnIndex),
            npcId: asString(turn.npcId),
            targetNpcId: asString(turn.targetNpcId),
            inputMode: asString(turn.inputMode),
            playerText: asString(turn.rawPlayerText),
            normalizedInputSummary: asString(turn.normalizedInputSummary),
            promptContextSummary: asString(turn.llmPromptContextSummary),
            retrievedMemories: turn.retrievedMemories ?? [],
            retrievedKnowledge: turn.retrievedKnowledge ?? [],
          }),
          jsonParam({
            replyText: asString(turn.modelReplyText),
            emotion: turn.emotion ?? null,
            intent: turn.intent ?? null,
            candidateActions: turn.candidateActions ?? [],
            selectedAction: turn.selectedAction ?? null,
            structuredImpact: turn.structuredImpact ?? null,
          }),
          jsonParam({
            relationshipDelta: turn.relationshipDelta ?? null,
            pressureChanges: turn.pressureChanges ?? [],
            leaderBefore: turn.leaderBefore ?? null,
            leaderAfter: turn.leaderAfter ?? null,
            resolutionAfter: turn.resolutionAfter ?? null,
          }),
          null,
          null,
          null,
          null,
          null,
          false,
          jsonParam(null),
        ],
      );
    }
  });
}
