-- The submitted object is a normalized deterministic bot brain, not an ML model.
-- Rename the live tables/keys in place so existing match and audit history survives.
ALTER TABLE model_submissions RENAME TO bot_brain_submissions;
ALTER TABLE validation_results RENAME TO bot_brain_validation_results;

ALTER TABLE bot_brain_submissions RENAME COLUMN model_artifacts TO brain_payload;
ALTER TABLE bot_brain_submissions RENAME COLUMN request_fingerprint TO submission_fingerprint;
ALTER TABLE bot_brain_validation_results RENAME COLUMN model_submission_id TO bot_brain_submission_id;
ALTER TABLE match_participants RENAME COLUMN model_submission_id TO bot_brain_submission_id;

ALTER INDEX model_submissions_user_id_idx RENAME TO bot_brain_submissions_user_id_idx;
ALTER INDEX model_submissions_status_idx RENAME TO bot_brain_submissions_status_idx;
ALTER INDEX model_submissions_match_user_idx RENAME TO bot_brain_submissions_match_user_idx;
ALTER INDEX model_submissions_selected_class_idx RENAME TO bot_brain_submissions_selected_class_idx;
ALTER INDEX model_submissions_user_training_session_unique_idx
    RENAME TO bot_brain_submissions_user_training_session_unique_idx;
ALTER INDEX validation_results_model_submission_id_idx
    RENAME TO bot_brain_validation_results_submission_id_idx;
ALTER INDEX match_participants_model_submission_id_idx
    RENAME TO match_participants_bot_brain_submission_id_idx;

ALTER TABLE bot_brain_submissions
    ADD COLUMN brain_schema_version VARCHAR(50);

UPDATE bot_brain_submissions
SET brain_schema_version = COALESCE(
    NULLIF(brain_payload ->> 'version', ''),
    NULLIF(architecture_version, ''),
    'legacy-unknown');

ALTER TABLE bot_brain_submissions
    ALTER COLUMN brain_schema_version SET NOT NULL,
    ALTER COLUMN brain_payload SET DEFAULT '{}'::jsonb,
    DROP COLUMN architecture_version,
    DROP COLUMN feature_schema_version,
    DROP COLUMN action_schema_version,
    DROP COLUMN training_duration_ms,
    DROP COLUMN training_steps,
    DROP COLUMN training_metrics;

DROP INDEX model_submissions_model_hash_idx;

ALTER TABLE bot_brain_submissions
    DROP COLUMN base_model_artifact_id,
    DROP COLUMN model_hash;

ALTER TABLE bot_brain_submissions
    RENAME CONSTRAINT model_submissions_status_check TO bot_brain_submissions_status_check;
ALTER TABLE bot_brain_submissions
    RENAME CONSTRAINT model_submissions_user_id_fk TO bot_brain_submissions_user_id_fk;
ALTER TABLE bot_brain_submissions
    RENAME CONSTRAINT model_submissions_match_id_fk TO bot_brain_submissions_match_id_fk;
ALTER TABLE bot_brain_validation_results
    RENAME CONSTRAINT validation_results_status_check TO bot_brain_validation_results_status_check;
ALTER TABLE bot_brain_validation_results
    RENAME CONSTRAINT validation_results_model_submission_id_fk TO bot_brain_validation_results_submission_id_fk;
ALTER TABLE match_participants
    RENAME CONSTRAINT match_participants_model_submission_id_fk TO match_participants_bot_brain_submission_id_fk;
