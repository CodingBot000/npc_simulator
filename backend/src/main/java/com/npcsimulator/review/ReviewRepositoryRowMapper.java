package com.npcsimulator.review;

import java.sql.ResultSet;
import java.sql.SQLException;
import org.springframework.stereotype.Component;

@Component
class ReviewRepositoryRowMapper {

    private final ReviewJdbcSupport jdbcSupport;

    ReviewRepositoryRowMapper(ReviewJdbcSupport jdbcSupport) {
        this.jdbcSupport = jdbcSupport;
    }

    ReviewRepository.ReviewTaskRow mapReviewTaskRow(ResultSet rs) throws SQLException {
        return new ReviewRepository.ReviewTaskRow(
            rs.getLong("id"),
            rs.getString("review_uid"),
            rs.getString("review_kind"),
            jdbcSupport.getNullableLong(rs, "sft_candidate_id"),
            jdbcSupport.getNullableLong(rs, "preference_pair_id"),
            rs.getString("bucket"),
            rs.getString("priority"),
            rs.getString("status"),
            jdbcSupport.getNullableBoolean(rs, "review_required"),
            rs.getString("queue_reason"),
            jdbcSupport.readJson(rs, "selection_reasons_json"),
            jdbcSupport.readJson(rs, "selection_metrics_json"),
            jdbcSupport.readJson(rs, "llm_first_pass_json"),
            jdbcSupport.readJson(rs, "checklist_json"),
            rs.getString("current_decision"),
            rs.getString("current_reviewer"),
            jdbcSupport.toIsoString(rs.getTimestamp("current_reviewed_at")),
            rs.getString("current_notes"),
            jdbcSupport.toIsoString(rs.getTimestamp("created_at")),
            jdbcSupport.toIsoString(rs.getTimestamp("updated_at"))
        );
    }

    ReviewRepository.CandidateRow mapCandidateRow(ResultSet rs) throws SQLException {
        return new ReviewRepository.CandidateRow(
            rs.getLong("id"),
            rs.getString("row_key"),
            rs.getString("canonical_row_key"),
            jdbcSupport.readJson(rs, "prompt_bundle_json"),
            jdbcSupport.readJson(rs, "assistant_output_json"),
            jdbcSupport.readJson(rs, "metadata_json"),
            jdbcSupport.readJson(rs, "judge_result_json"),
            jdbcSupport.readJson(rs, "filter_result_json"),
            jdbcSupport.getNullableBigDecimal(rs, "weighted_judge_score"),
            rs.getString("strategy_label"),
            rs.getString("scenario_id"),
            rs.getString("npc_id"),
            rs.getString("target_npc_id"),
            rs.getString("input_mode"),
            rs.getString("source_export_path"),
            rs.getString("source_label")
        );
    }

    ReviewRepository.PairRow mapPairRow(ResultSet rs) throws SQLException {
        return new ReviewRepository.PairRow(
            rs.getLong("id"),
            rs.getString("pair_key"),
            rs.getString("grouping_strategy"),
            rs.getString("grouping_key"),
            jdbcSupport.readJson(rs, "prompt_bundle_json"),
            jdbcSupport.getNullableLong(rs, "chosen_candidate_id"),
            jdbcSupport.getNullableLong(rs, "rejected_candidate_id"),
            jdbcSupport.readJson(rs, "pair_reason_json"),
            jdbcSupport.getNullableBigDecimal(rs, "weighted_gap"),
            jdbcSupport.getNullableBigDecimal(rs, "pair_confidence"),
            jdbcSupport.getNullableBigDecimal(rs, "preference_strength"),
            jdbcSupport.readJson(rs, "judge_result_json"),
            rs.getString("pair_decision")
        );
    }

    ReviewRepository.SnapshotSummaryRow mapSnapshotSummaryRow(ResultSet rs) throws SQLException {
        return new ReviewRepository.SnapshotSummaryRow(
            rs.getLong("id"),
            rs.getString("dataset_kind"),
            rs.getString("dataset_version"),
            rs.getString("source_fingerprint"),
            rs.getString("output_uri"),
            jdbcSupport.readJson(rs, "manifest_json"),
            jdbcSupport.toIsoString(rs.getTimestamp("generated_at"))
        );
    }

    ReviewRepository.TrainingRunRow mapTrainingRunRow(ResultSet rs) throws SQLException {
        return new ReviewRepository.TrainingRunRow(
            rs.getLong("id"),
            rs.getString("run_uid"),
            rs.getString("run_kind"),
            rs.getString("state"),
            rs.getString("current_step"),
            rs.getString("message"),
            jdbcSupport.getNullableLong(rs, "source_snapshot_id"),
            rs.getString("base_model"),
            rs.getString("training_backend"),
            rs.getString("output_adapter_path"),
            rs.getString("output_adapter_version"),
            rs.getString("runtime_artifact_path"),
            rs.getString("runtime_artifact_kind"),
            rs.getString("remote_provider"),
            rs.getString("remote_job_id"),
            rs.getString("remote_training_file_id"),
            rs.getString("remote_validation_file_id"),
            rs.getString("remote_model_name"),
            rs.getString("dataset_work_dir"),
            rs.getString("run_fingerprint"),
            rs.getString("source_fingerprint"),
            jdbcSupport.readJson(rs, "params_json"),
            jdbcSupport.readJson(rs, "metrics_json"),
            rs.getString("eval_state"),
            rs.getString("eval_message"),
            rs.getString("eval_binding_key"),
            rs.getString("eval_baseline_label"),
            rs.getString("eval_summary_path"),
            jdbcSupport.readJson(rs, "eval_summary_json"),
            jdbcSupport.toIsoString(rs.getTimestamp("eval_started_at")),
            jdbcSupport.toIsoString(rs.getTimestamp("eval_finished_at")),
            rs.getString("review_decision"),
            rs.getString("review_notes"),
            rs.getString("reviewed_by"),
            jdbcSupport.toIsoString(rs.getTimestamp("reviewed_at")),
            rs.getString("promoted_binding_key"),
            jdbcSupport.toIsoString(rs.getTimestamp("promoted_at")),
            jdbcSupport.toIsoString(rs.getTimestamp("started_at")),
            jdbcSupport.toIsoString(rs.getTimestamp("finished_at")),
            jdbcSupport.toIsoString(rs.getTimestamp("updated_at")),
            jdbcSupport.toIsoString(rs.getTimestamp("created_at"))
        );
    }
}
