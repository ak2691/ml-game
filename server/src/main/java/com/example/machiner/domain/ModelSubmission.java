package com.example.machiner.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "model_submissions")
public class ModelSubmission {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    @Column(name = "architecture_version", nullable = false, length = 50)
    private String architectureVersion;

    @Column(name = "feature_schema_version", nullable = false, length = 50)
    private String featureSchemaVersion;

    @Column(name = "action_schema_version", nullable = false, length = 50)
    private String actionSchemaVersion = "movement-v1";

    @Column(name = "training_session_id", length = 100)
    private String trainingSessionId;

    @Column(name = "training_duration_ms")
    private Integer trainingDurationMs;

    @Column(name = "training_steps")
    private Integer trainingSteps;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "reward_events", nullable = false)
    private String rewardEvents = "{}";

    @Column(name = "model_hash", length = 128)
    private String modelHash;

    @Column(name = "client_build_version", length = 100)
    private String clientBuildVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "model_artifacts", nullable = false)
    private String modelArtifacts = "{}";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ModelSubmissionStatus status = ModelSubmissionStatus.PENDING_VALIDATION;

    @Column(name = "submitted_at", nullable = false, updatable = false, insertable = false)
    private Instant submittedAt;

    @Column(name = "updated_at", nullable = false, insertable = false)
    private Instant updatedAt;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public AppUser getUser() {
        return user;
    }

    public void setUser(AppUser user) {
        this.user = user;
    }

    public String getArchitectureVersion() {
        return architectureVersion;
    }

    public void setArchitectureVersion(String architectureVersion) {
        this.architectureVersion = architectureVersion;
    }

    public String getFeatureSchemaVersion() {
        return featureSchemaVersion;
    }

    public void setFeatureSchemaVersion(String featureSchemaVersion) {
        this.featureSchemaVersion = featureSchemaVersion;
    }

    public String getActionSchemaVersion() {
        return actionSchemaVersion;
    }

    public void setActionSchemaVersion(String actionSchemaVersion) {
        this.actionSchemaVersion = actionSchemaVersion;
    }

    public String getTrainingSessionId() {
        return trainingSessionId;
    }

    public void setTrainingSessionId(String trainingSessionId) {
        this.trainingSessionId = trainingSessionId;
    }

    public Integer getTrainingDurationMs() {
        return trainingDurationMs;
    }

    public void setTrainingDurationMs(Integer trainingDurationMs) {
        this.trainingDurationMs = trainingDurationMs;
    }

    public Integer getTrainingSteps() {
        return trainingSteps;
    }

    public void setTrainingSteps(Integer trainingSteps) {
        this.trainingSteps = trainingSteps;
    }

    public String getRewardEvents() {
        return rewardEvents;
    }

    public void setRewardEvents(String rewardEvents) {
        this.rewardEvents = rewardEvents;
    }

    public String getModelHash() {
        return modelHash;
    }

    public void setModelHash(String modelHash) {
        this.modelHash = modelHash;
    }

    public String getClientBuildVersion() {
        return clientBuildVersion;
    }

    public void setClientBuildVersion(String clientBuildVersion) {
        this.clientBuildVersion = clientBuildVersion;
    }

    public String getModelArtifacts() {
        return modelArtifacts;
    }

    public void setModelArtifacts(String modelArtifacts) {
        this.modelArtifacts = modelArtifacts;
    }

    public ModelSubmissionStatus getStatus() {
        return status;
    }

    public void setStatus(ModelSubmissionStatus status) {
        this.status = status;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
