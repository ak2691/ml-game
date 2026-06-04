ALTER TABLE model_submissions
    ADD COLUMN model_artifacts JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE match_participants
    ADD COLUMN participant_role VARCHAR(40);

CREATE INDEX match_participants_role_idx ON match_participants (participant_role);
