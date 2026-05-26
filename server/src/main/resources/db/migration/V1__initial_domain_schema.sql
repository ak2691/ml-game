CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_username_length CHECK (char_length(username) >= 3)
);

CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    matches_played INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT profiles_user_id_unique UNIQUE (user_id),
    CONSTRAINT profiles_matches_played_nonnegative CHECK (matches_played >= 0),
    CONSTRAINT profiles_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    ruleset_version VARCHAR(50) NOT NULL,
    simulation_seed BIGINT,
    winner_user_id UUID,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT matches_status_check
        CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED')),
    CONSTRAINT matches_winner_user_id_fk
        FOREIGN KEY (winner_user_id)
        REFERENCES users (id)
        ON DELETE SET NULL
);

CREATE TABLE model_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    architecture_version VARCHAR(50) NOT NULL,
    feature_schema_version VARCHAR(50) NOT NULL,
    action_schema_version VARCHAR(50) NOT NULL DEFAULT 'movement-v1',
    training_session_id VARCHAR(100),
    training_duration_ms INTEGER,
    training_steps INTEGER,
    reward_events JSONB NOT NULL DEFAULT '{}'::jsonb,
    model_hash VARCHAR(128),
    client_build_version VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_VALIDATION',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT model_submissions_training_duration_nonnegative
        CHECK (training_duration_ms IS NULL OR training_duration_ms >= 0),
    CONSTRAINT model_submissions_training_steps_nonnegative
        CHECK (training_steps IS NULL OR training_steps >= 0),
    CONSTRAINT model_submissions_status_check
        CHECK (status IN ('PENDING_VALIDATION', 'VALIDATED', 'REJECTED', 'ARCHIVED')),
    CONSTRAINT model_submissions_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE TABLE validation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_submission_id UUID NOT NULL,
    status VARCHAR(30) NOT NULL,
    validator_version VARCHAR(50) NOT NULL,
    rejection_code VARCHAR(100),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT validation_results_status_check
        CHECK (status IN ('ACCEPTED', 'REJECTED', 'ERROR')),
    CONSTRAINT validation_results_model_submission_id_fk
        FOREIGN KEY (model_submission_id)
        REFERENCES model_submissions (id)
        ON DELETE CASCADE
);

CREATE TABLE match_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL,
    user_id UUID NOT NULL,
    model_submission_id UUID,
    slot SMALLINT NOT NULL,
    result VARCHAR(20),
    rating_before INTEGER,
    rating_after INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT match_participants_slot_check CHECK (slot IN (1, 2)),
    CONSTRAINT match_participants_result_check
        CHECK (result IS NULL OR result IN ('WIN', 'LOSS', 'DRAW', 'FORFEIT')),
    CONSTRAINT match_participants_match_slot_unique UNIQUE (match_id, slot),
    CONSTRAINT match_participants_match_user_unique UNIQUE (match_id, user_id),
    CONSTRAINT match_participants_match_id_fk
        FOREIGN KEY (match_id)
        REFERENCES matches (id)
        ON DELETE CASCADE,
    CONSTRAINT match_participants_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT match_participants_model_submission_id_fk
        FOREIGN KEY (model_submission_id)
        REFERENCES model_submissions (id)
        ON DELETE SET NULL
);

CREATE INDEX profiles_user_id_idx ON profiles (user_id);
CREATE UNIQUE INDEX users_username_lower_unique_idx ON users (lower(username));
CREATE INDEX matches_status_idx ON matches (status);
CREATE INDEX model_submissions_user_id_idx ON model_submissions (user_id);
CREATE INDEX model_submissions_status_idx ON model_submissions (status);
CREATE INDEX validation_results_model_submission_id_idx ON validation_results (model_submission_id);
CREATE INDEX match_participants_user_id_idx ON match_participants (user_id);
CREATE INDEX match_participants_model_submission_id_idx ON match_participants (model_submission_id);
