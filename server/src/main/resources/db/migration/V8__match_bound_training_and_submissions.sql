ALTER TABLE training_sessions
    ADD COLUMN match_id UUID;

ALTER TABLE training_sessions
    ADD CONSTRAINT training_sessions_match_id_fk
        FOREIGN KEY (match_id)
        REFERENCES matches (id)
        ON DELETE SET NULL;

CREATE INDEX training_sessions_match_user_idx ON training_sessions (match_id, user_id);

ALTER TABLE model_submissions
    ADD COLUMN match_id UUID;

ALTER TABLE model_submissions
    ADD CONSTRAINT model_submissions_match_id_fk
        FOREIGN KEY (match_id)
        REFERENCES matches (id)
        ON DELETE SET NULL;

CREATE INDEX model_submissions_match_user_idx ON model_submissions (match_id, user_id);
