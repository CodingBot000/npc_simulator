ALTER TABLE npc_world_instances
    ADD COLUMN episode_uid VARCHAR(64);

ALTER TABLE npc_world_instances
    ADD COLUMN world_state_json JSON;

ALTER TABLE npc_world_instances
    ADD COLUMN memory_file_json JSON;

ALTER TABLE npc_world_instances
    ADD COLUMN interaction_log_json JSON;

CREATE INDEX idx_npc_world_instances_episode_uid
    ON npc_world_instances(episode_uid);
