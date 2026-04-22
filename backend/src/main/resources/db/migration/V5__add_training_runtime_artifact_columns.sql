ALTER TABLE npc_training_run
    ADD COLUMN runtime_artifact_path VARCHAR(512);

ALTER TABLE npc_training_run
    ADD COLUMN runtime_artifact_kind VARCHAR(64);

UPDATE npc_training_run
   SET runtime_artifact_path = output_adapter_path,
       runtime_artifact_kind = 'legacy_mlx_adapter'
 WHERE runtime_artifact_path IS NULL
   AND output_adapter_path IS NOT NULL;
