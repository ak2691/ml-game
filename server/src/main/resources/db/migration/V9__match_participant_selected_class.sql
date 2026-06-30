ALTER TABLE model_submissions
    ADD COLUMN selected_class VARCHAR(40);

ALTER TABLE match_participants
    ADD COLUMN selected_class VARCHAR(40);

CREATE INDEX model_submissions_selected_class_idx ON model_submissions (selected_class);
CREATE INDEX match_participants_selected_class_idx ON match_participants (selected_class);
