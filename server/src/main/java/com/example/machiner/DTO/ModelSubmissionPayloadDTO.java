package com.example.machiner.DTO;

import tools.jackson.databind.JsonNode;

public class ModelSubmissionPayloadDTO {

    private String architectureVersion;
    private String featureSchemaVersion;
    private String actionSchemaVersion;
    private String modelFormat;
    private String trainingSessionId;
    private Integer trainingDurationMs;
    private Integer trainingSteps;
    private JsonNode rewardEvents;
    private String modelHash;
    private String clientBuildVersion;
    private JsonNode model;

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

    public String getModelFormat() {
        return modelFormat;
    }

    public void setModelFormat(String modelFormat) {
        this.modelFormat = modelFormat;
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

    public JsonNode getRewardEvents() {
        return rewardEvents;
    }

    public void setRewardEvents(JsonNode rewardEvents) {
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

    public JsonNode getModel() {
        return model;
    }

    public void setModel(JsonNode model) {
        this.model = model;
    }
}
