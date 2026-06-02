ALTER TABLE users
    ADD COLUMN email VARCHAR(255),
    ADD COLUMN normalized_email VARCHAR(255);

UPDATE users
SET email = username || '@prototype.local',
    normalized_email = lower(username || '@prototype.local')
WHERE email IS NULL;

ALTER TABLE users
    ALTER COLUMN email SET NOT NULL,
    ALTER COLUMN normalized_email SET NOT NULL;

CREATE UNIQUE INDEX users_normalized_email_unique_idx ON users (normalized_email);
