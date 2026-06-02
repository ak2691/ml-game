CREATE TABLE training_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT training_sessions_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE SET NULL
);

CREATE INDEX training_sessions_user_id_idx ON training_sessions (user_id);
CREATE INDEX training_sessions_started_at_idx ON training_sessions (started_at);
