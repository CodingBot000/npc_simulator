ALTER TABLE npc_training_run
    ADD COLUMN eval_state VARCHAR(16);

ALTER TABLE npc_training_run
    ADD COLUMN eval_message TEXT;

ALTER TABLE npc_training_run
    ADD COLUMN eval_binding_key VARCHAR(64);

ALTER TABLE npc_training_run
    ADD COLUMN eval_baseline_label VARCHAR(128);

ALTER TABLE npc_training_run
    ADD COLUMN eval_summary_path VARCHAR(512);

ALTER TABLE npc_training_run
    ADD COLUMN eval_summary_json JSON;

ALTER TABLE npc_training_run
    ADD COLUMN eval_started_at TIMESTAMP;

ALTER TABLE npc_training_run
    ADD COLUMN eval_finished_at TIMESTAMP;

ALTER TABLE npc_training_run
    ADD COLUMN review_decision VARCHAR(16);

ALTER TABLE npc_training_run
    ADD COLUMN review_notes TEXT;

ALTER TABLE npc_training_run
    ADD COLUMN reviewed_by VARCHAR(255);

ALTER TABLE npc_training_run
    ADD COLUMN reviewed_at TIMESTAMP;

ALTER TABLE npc_training_run
    ADD COLUMN promoted_binding_key VARCHAR(64);

ALTER TABLE npc_training_run
    ADD COLUMN promoted_at TIMESTAMP;

CREATE INDEX idx_npc_training_run_promoted_binding
    ON npc_training_run(promoted_binding_key, promoted_at);
