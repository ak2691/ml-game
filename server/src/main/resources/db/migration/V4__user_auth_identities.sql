CREATE TABLE user_auth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    provider VARCHAR(50) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    email_verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_auth_identities_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT user_auth_identities_provider_nonempty
        CHECK (char_length(trim(provider)) > 0),
    CONSTRAINT user_auth_identities_provider_subject_nonempty
        CHECK (char_length(trim(provider_subject)) > 0),
    CONSTRAINT user_auth_identities_provider_subject_unique
        UNIQUE (provider, provider_subject)
);

CREATE INDEX user_auth_identities_user_id_idx ON user_auth_identities (user_id);
