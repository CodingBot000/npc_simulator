ALTER TABLE npc_training_run
    ADD COLUMN training_backend VARCHAR(64);

ALTER TABLE npc_training_run
    ADD COLUMN remote_provider VARCHAR(64);

ALTER TABLE npc_training_run
    ADD COLUMN remote_job_id VARCHAR(128);

ALTER TABLE npc_training_run
    ADD COLUMN remote_training_file_id VARCHAR(128);

ALTER TABLE npc_training_run
    ADD COLUMN remote_validation_file_id VARCHAR(128);

ALTER TABLE npc_training_run
    ADD COLUMN remote_model_name VARCHAR(255);

UPDATE npc_training_run
   SET training_backend = 'local_peft'
 WHERE training_backend IS NULL
   AND (output_adapter_path IS NOT NULL OR runtime_artifact_path IS NOT NULL);

