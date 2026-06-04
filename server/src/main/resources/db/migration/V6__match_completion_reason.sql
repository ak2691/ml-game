ALTER TABLE matches
    ADD COLUMN completion_reason VARCHAR(50);

CREATE INDEX matches_completion_reason_idx ON matches (completion_reason);
