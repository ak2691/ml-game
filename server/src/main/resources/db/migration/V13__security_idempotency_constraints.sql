ALTER TABLE model_submissions
    ADD COLUMN request_fingerprint VARCHAR(64);

CREATE UNIQUE INDEX model_submissions_user_training_session_unique_idx
    ON model_submissions (user_id, training_session_id)
    WHERE training_session_id IS NOT NULL
      AND request_fingerprint IS NOT NULL;

ALTER TABLE matches
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
