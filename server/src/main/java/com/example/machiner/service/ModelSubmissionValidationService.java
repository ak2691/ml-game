package com.example.machiner.service;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import com.example.machiner.DTO.ModelSubmissionValidationResponseDTO;
import com.example.machiner.simulation.classes.CombatClassRegistry;
import com.example.machiner.simulation.classes.CombatClassSpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ModelSubmissionValidationService {

    private static final String VALIDATOR_VERSION = "bot-brain-submission-v1";
    private static final String ARCHITECTURE_VERSION = "deterministic-logic-v1";
    private static final String FEATURE_SCHEMA_VERSION = "duel-logic-features-v1";
    private static final String ACTION_SCHEMA_VERSION = "melee-logic-actions-v1";
    private static final String MODEL_FORMAT = "logic-blocks-v1";
    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TRAINING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_MODEL_HASH_LENGTH = 128;
    private static final int MAX_SELECTED_CLASS_LENGTH = 40;
    private static final int MAX_BASE_MODEL_ARTIFACT_ID_LENGTH = 100;
    private static final int MAX_LOGIC_BLOCKS = 50;
    private static final int MAX_CLUSTERS = 12;
    private static final int MAX_CONDITIONS_PER_BLOCK = 4;
    private static final int MAX_ROUND_TRAINING_STEPS = 0;
    private static final Set<String> MOVEMENT_ACTIONS = Set.of(
            "move_inward",
            "move_outward",
            "move_tangent_left",
            "move_tangent_right",
            "move_diagonal_in_left",
            "move_diagonal_in_right",
            "move_diagonal_out_left",
            "move_diagonal_out_right",
            "move_center",
            "move_north",
            "move_south",
            "move_east",
            "move_west",
            "move_northeast",
            "move_northwest",
            "move_southeast",
            "move_southwest",
            "move_stop",
            "rotate_toward_enemy");
    private static final Set<String> DASH_ACTIONS = Set.of(
            "no_dash",
            "dash",
            "dash_outward",
            "dash_tangent_left",
            "dash_tangent_right",
            "dash_diagonal_in_left",
            "dash_diagonal_in_right",
            "dash_diagonal_out_left",
            "dash_diagonal_out_right",
            "dash_north",
            "dash_south",
            "dash_east",
            "dash_west",
            "dash_northeast",
            "dash_northwest",
            "dash_southeast",
            "dash_southwest");
    private static final Set<String> SWING_CONDITIONS = Set.of("my_swing_ready", "my_swing_cooldown");
    private static final Set<String> BLOCK_CONDITIONS = Set.of("my_block_ready", "my_block_cooldown");
    private static final Set<String> SHIELD_CONDITIONS = Set.of(
            "my_shield_up",
            "my_shield_down",
            "my_shield_charges_lt",
            "my_shield_charges_gt");
    private static final Set<String> DASH_CONDITIONS = Set.of(
            "my_dash_ready",
            "my_dash_cooldown",
            "my_dash_charges_lt",
            "my_dash_charges_gt");
    private static final Set<String> GUN_CONDITIONS = Set.of("my_fire_gun_ready", "my_fire_gun_cooldown");
    private static final Set<String> GRENADE_CONDITIONS = Set.of("my_grenade_ready", "my_grenade_cooldown");
    private static final Set<String> FIREBALL_CONDITIONS = Set.of("my_fireball_ready", "my_fireball_cooldown");
    private static final Set<String> STUN_CONDITIONS = Set.of("my_stun_ready", "my_stun_cooldown");
    private static final Set<String> NUMBER_VARIABLES = Set.of(
            "my.hp",
            "my.x",
            "my.y",
            "opponent.hp",
            "opponent.x",
            "opponent.y",
            "my.overdriveMs",
            "my.barrierMs",
            "my.slowedMs",
            "my.jammedMs",
            "my.commandLockedMs",
            "opponent.overdriveMs",
            "opponent.barrierMs",
            "opponent.slowedMs",
            "opponent.jammedMs",
            "opponent.commandLockedMs",
            "target.distance",
            "opponent.objectDistance",
            "my.edgeDistance",
            "target.edgeDistance",
            "my.swingCooldownMs",
            "my.shieldCharges",
            "my.blockRechargeMs",
            "my.dashCooldownMs",
            "my.dashCharges",
            "my.gunCooldownMs",
            "my.gunAmmo",
            "my.gunReloadMs",
            "my.grenadeCooldownMs",
            "my.fireballCooldownMs",
            "my.fireballCharges",
            "my.fireballReloadMs",
            "my.stunCooldownMs",
            "opponent.swingCooldownMs",
            "opponent.shieldCharges",
            "opponent.blockRechargeMs",
            "opponent.dashCooldownMs",
            "opponent.dashCharges",
            "opponent.gunCooldownMs",
            "opponent.gunAmmo",
            "opponent.gunReloadMs",
            "opponent.grenadeCooldownMs",
            "opponent.fireballCooldownMs",
            "opponent.fireballCharges",
            "opponent.fireballReloadMs",
            "opponent.stunCooldownMs");
    private static final Set<String> BOOLEAN_VARIABLES = Set.of(
            "my.swingReady",
            "my.blockReady",
            "my.shieldUp",
            "my.dashReady",
            "my.gunReady",
            "my.grenadeReady",
            "my.fireballReady",
            "my.stunReady",
            "opponent.swingReady",
            "opponent.blockReady",
            "opponent.shieldUp",
            "opponent.dashReady",
            "opponent.gunReady",
            "opponent.grenadeReady",
            "opponent.fireballReady",
            "opponent.stunReady",
            "my.jammed",
            "my.commandLocked",
            "opponent.jammed",
            "opponent.commandLocked",
            "target.exists",
            "target.isHealthPack",
            "target.isDamageZone",
            "target.isProjectileWall",
            "target.isBouncyWall",
            "my.insideDamageZone");
    private static final Set<String> NUMERIC_COMPARATORS = Set.of("lt", "lte", "eq", "neq", "gte", "gt");
    private static final Set<String> BOOLEAN_COMPARATORS = Set.of("eq", "neq");

    private final JsonMapper jsonMapper;
    private final CombatClassRegistry combatClasses;

    public ModelSubmissionValidationService(JsonMapper jsonMapper, CombatClassRegistry combatClasses) {
        this.jsonMapper = jsonMapper;
        this.combatClasses = combatClasses;
    }

    public ModelSubmissionValidationResponseDTO validate(ModelSubmissionPayloadDTO payload) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (payload == null) {
            errors.add("submission payload is required");
            return response(false, errors, warnings, null, null, false);
        }

        requireExact(errors, payload.getArchitectureVersion(), "architectureVersion", ARCHITECTURE_VERSION);
        requireExact(errors, payload.getFeatureSchemaVersion(), "featureSchemaVersion", FEATURE_SCHEMA_VERSION);
        requireExact(errors, payload.getActionSchemaVersion(), "actionSchemaVersion", ACTION_SCHEMA_VERSION);
        requireExact(errors, payload.getModelFormat(), "modelFormat", MODEL_FORMAT);

        rejectTooLong(errors, payload.getArchitectureVersion(), "architectureVersion", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getFeatureSchemaVersion(), "featureSchemaVersion", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getActionSchemaVersion(), "actionSchemaVersion", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getModelFormat(), "modelFormat", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getTrainingSessionId(), "trainingSessionId", MAX_TRAINING_SESSION_ID_LENGTH);
        rejectTooLong(errors, payload.getSelectedClass(), "selectedClass", MAX_SELECTED_CLASS_LENGTH);
        rejectTooLong(errors, payload.getBaseModelArtifactId(),
                "baseModelArtifactId", MAX_BASE_MODEL_ARTIFACT_ID_LENGTH);
        rejectTooLong(errors, payload.getModelHash(), "modelHash", MAX_MODEL_HASH_LENGTH);
        rejectTooLong(errors, payload.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        requireText(errors, payload.getTrainingSessionId(), "trainingSessionId");
        requireUuid(errors, payload.getTrainingSessionId(), "trainingSessionId");
        rejectNegative(errors, payload.getTrainingDurationMs(), "trainingDurationMs");
        rejectNegative(errors, payload.getTrainingSteps(), "trainingSteps");
        requireNonNegative(errors, payload.getTrainingSteps(), "trainingSteps");
        if (payload.getTrainingSteps() != null && payload.getTrainingSteps() != MAX_ROUND_TRAINING_STEPS) {
            errors.add("trainingSteps must be 0 for deterministic bot brains");
        }
        if (requireObject(errors, payload.getTrainingMetrics(), "trainingMetrics")) {
            validateRoundTrainingLimits(errors, payload.getTrainingMetrics());
        }
        CombatClassSpec classSpec = combatClasses.forId(hasText(payload.getSelectedClass()) ? payload.getSelectedClass() : "melee");
        validateBrain(errors, submittedBrain(payload), classSpec);

        String computedHash = null;
        JsonNode brain = submittedBrain(payload);
        if (brain != null && brain.isObject()) {
            computedHash = computeModelHash(brain, errors);
        }

        if (hasText(payload.getModelHash())) {
            if (computedHash != null && !payload.getModelHash().equals(computedHash)) {
                warnings.add("submitted modelHash does not match server-computed hash; server hash is authoritative");
            }
        } else {
            warnings.add("modelHash was not provided; server computed one from submitted brain");
        }

        if (payload.getTrainingDurationMs() == null) {
            warnings.add("trainingDurationMs will be computed from the server-owned training session");
        }

        return response(errors.isEmpty(), errors, warnings, payload.getModelHash(), computedHash,
                payload.getTrainingDurationMs() != null);
    }

    private ModelSubmissionValidationResponseDTO response(
            boolean accepted,
            List<String> errors,
            List<String> warnings,
            String submittedHash,
            String computedHash,
            boolean trainingDurationTrusted) {
        ModelSubmissionValidationResponseDTO response = new ModelSubmissionValidationResponseDTO();
        response.setAccepted(accepted);
        response.setStatus(accepted ? "ACCEPTED" : "REJECTED");
            response.setMessage(accepted
                ? "Bot brain passed validation"
                : "Bot brain failed validation");
        response.setValidatorVersion(VALIDATOR_VERSION);
        response.setSubmittedModelHash(submittedHash);
        response.setComputedModelHash(computedHash);
        response.setTrainingDurationTrusted(trainingDurationTrusted);
        response.setErrors(errors);
        response.setWarnings(warnings);
        return response;
    }

    private void validateBrain(List<String> errors, JsonNode brain, CombatClassSpec classSpec) {
        if (!requireObject(errors, brain, "brain")) {
            return;
        }

        if (!brain.hasNonNull("version") || !brain.get("version").isTextual()) {
            errors.add("brain.version must be a string");
        }

        if (!brain.hasNonNull("blocks") || !brain.get("blocks").isArray()) {
            errors.add("brain.blocks must be an array");
            return;
        }

        int blockCount = 0;
        JsonNode blocks = brain.get("blocks");
        blockCount += blocks.size();
        if (blockCount > MAX_LOGIC_BLOCKS) {
            errors.add("brain.blocks exceeds the logic block limit");
        }
        for (int index = 0; index < blocks.size(); index++) {
            validateLogicBlock(errors, blocks.get(index), "brain.blocks[" + index + "]", classSpec);
        }

        JsonNode clusters = brain.get("clusters");
        if (clusters != null) {
            if (!clusters.isArray()) {
                errors.add("brain.clusters must be an array");
            } else {
                if (clusters.size() > MAX_CLUSTERS) {
                    errors.add("brain.clusters exceeds the cluster limit");
                }
                for (int clusterIndex = 0; clusterIndex < clusters.size(); clusterIndex++) {
                    JsonNode cluster = clusters.get(clusterIndex);
                    String clusterPath = "brain.clusters[" + clusterIndex + "]";
                    if (!cluster.isObject()) {
                        errors.add(clusterPath + " must be an object");
                        continue;
                    }
                    JsonNode clusterConditions = cluster.get("conditions");
                    if (clusterConditions == null || !clusterConditions.isArray()) {
                        errors.add(clusterPath + ".conditions must be an array");
                    } else if (clusterConditions.size() > MAX_CONDITIONS_PER_BLOCK) {
                        errors.add(clusterPath + ".conditions exceeds the condition limit");
                    }
                    JsonNode clusterBlocks = cluster.get("blocks");
                    if (clusterBlocks == null || !clusterBlocks.isArray()) {
                        errors.add(clusterPath + ".blocks must be an array");
                        continue;
                    }
                    blockCount += clusterBlocks.size();
                    if (blockCount > MAX_LOGIC_BLOCKS) {
                        errors.add("brain blocks exceed the logic block limit");
                    }
                    for (int blockIndex = 0; blockIndex < clusterBlocks.size(); blockIndex++) {
                        validateLogicBlock(errors, clusterBlocks.get(blockIndex),
                                clusterPath + ".blocks[" + blockIndex + "]", classSpec);
                    }
                }
            }
        }
    }

    private void validateLogicBlock(List<String> errors, JsonNode block, String path, CombatClassSpec classSpec) {
        if (!block.isObject()) {
            errors.add(path + " must be an object");
            return;
        }
        if (!block.hasNonNull("action") || !block.get("action").isTextual()) {
            errors.add(path + ".action must be a string");
        } else {
            validateActionAllowed(errors, block.get("action").asText(), path, classSpec);
        }
        JsonNode conditions = block.get("conditions");
        if (conditions == null || !conditions.isArray()) {
            errors.add(path + ".conditions must be an array");
        } else if (conditions.size() > MAX_CONDITIONS_PER_BLOCK) {
            errors.add(path + ".conditions exceeds the condition limit");
        } else {
            for (int index = 0; index < conditions.size(); index++) {
                validateConditionAllowed(errors, conditions.get(index), path + ".conditions[" + index + "]", classSpec);
            }
        }
    }

    private void validateActionAllowed(List<String> errors, String action, String path, CombatClassSpec classSpec) {
        Set<String> allowed = new HashSet<>(MOVEMENT_ACTIONS);
        if (classSpec.canSwing()) allowed.add("swing");
        if (classSpec.canBlock()) allowed.add("block");
        if (classSpec.canDash()) allowed.addAll(DASH_ACTIONS);
        if (classSpec.canFireGun()) allowed.add("fire_gun");
        if (classSpec.canThrowGrenade()) allowed.add("throw_grenade");
        if (classSpec.canShootFireball()) allowed.add("shoot_fireball");
        if (classSpec.canStun()) allowed.add("stun");
        if (!allowed.contains(action)) {
            errors.add(path + ".action is not allowed for " + classSpec.id());
        }
    }

    private void validateConditionAllowed(List<String> errors, JsonNode condition, String path, CombatClassSpec classSpec) {
        if (condition == null || !condition.isObject()) {
            errors.add(path + " must be an object");
            return;
        }
        JsonNode typeNode = condition.get("type");
        if (typeNode == null || !typeNode.isTextual()) {
            errors.add(path + ".type must be a string");
            return;
        }
        String type = typeNode.asText();
        if ("expression".equals(type)) {
            validateExpressionCondition(errors, condition, path, classSpec);
            return;
        }
        if ((!classSpec.canSwing() && SWING_CONDITIONS.contains(type))
                || (!classSpec.canBlock() && BLOCK_CONDITIONS.contains(type))
                || (!classSpec.canBlock() && SHIELD_CONDITIONS.contains(type))
                || (!classSpec.canDash() && DASH_CONDITIONS.contains(type))
                || (!classSpec.canFireGun() && GUN_CONDITIONS.contains(type))
                || (!classSpec.canThrowGrenade() && GRENADE_CONDITIONS.contains(type))
                || (!classSpec.canShootFireball() && FIREBALL_CONDITIONS.contains(type))
                || (!classSpec.canStun() && STUN_CONDITIONS.contains(type))) {
            errors.add(path + ".type is not allowed for " + classSpec.id());
        }
    }

    private void validateExpressionCondition(List<String> errors, JsonNode condition, String path, CombatClassSpec classSpec) {
        JsonNode leftNode = condition.get("left");
        if (leftNode == null || !leftNode.isTextual()) {
            errors.add(path + ".left must be a variable id");
            return;
        }
        String left = leftNode.asText();
        String valueType = variableValueType(left);
        if (valueType == null) {
            errors.add(path + ".left is not an allowed variable");
            return;
        }
        validateVariableAllowedForClass(errors, left, path + ".left", classSpec);

        JsonNode comparatorNode = condition.get("comparator");
        String comparator = comparatorNode != null && comparatorNode.isTextual() ? comparatorNode.asText() : "";
        if ("number".equals(valueType) && !NUMERIC_COMPARATORS.contains(comparator)) {
            errors.add(path + ".comparator is not allowed for number variables");
        }
        if ("boolean".equals(valueType) && !BOOLEAN_COMPARATORS.contains(comparator)) {
            errors.add(path + ".comparator is not allowed for boolean variables");
        }

        JsonNode right = condition.get("right");
        if (right == null || !right.isObject()) {
            errors.add(path + ".right must be an operand object");
            return;
        }
        JsonNode rightTypeNode = right.get("type");
        if (rightTypeNode == null || !rightTypeNode.isTextual()) {
            errors.add(path + ".right.type must be a string");
            return;
        }
        String rightType = rightTypeNode.asText();
        JsonNode rightValue = right.get("value");
        if ("number".equals(valueType)) {
            if ("number".equals(rightType)) {
                if (rightValue == null || !rightValue.isNumber()) {
                    errors.add(path + ".right.value must be a number");
                }
            } else if ("variable".equals(rightType)) {
                if (rightValue == null || !rightValue.isTextual() || !"number".equals(variableValueType(rightValue.asText()))) {
                    errors.add(path + ".right.value must be a number variable");
                } else {
                    validateVariableAllowedForClass(errors, rightValue.asText(), path + ".right.value", classSpec);
                }
            } else {
                errors.add(path + ".right.type is not allowed for number variables");
            }
        } else if ("boolean".equals(valueType)) {
            if (!"boolean".equals(rightType)) {
                errors.add(path + ".right.type is not allowed for boolean variables");
            } else if (rightValue == null || !rightValue.isBoolean()) {
                errors.add(path + ".right.value must be a boolean");
            }
        }
    }

    private String variableValueType(String variable) {
        if (NUMBER_VARIABLES.contains(variable)) return "number";
        if (BOOLEAN_VARIABLES.contains(variable)) return "boolean";
        return null;
    }

    private void validateVariableAllowedForClass(List<String> errors, String variable, String path, CombatClassSpec classSpec) {
        if (!variable.startsWith("my.")) return;
        if ((!classSpec.canSwing() && variable.contains("swing"))
                || (!classSpec.canBlock() && (variable.contains("block") || variable.contains("shield")))
                || (!classSpec.canDash() && variable.contains("dash"))
                || (!classSpec.canFireGun() && variable.contains("gun"))
                || (!classSpec.canThrowGrenade() && variable.contains("grenade"))
                || (!classSpec.canShootFireball() && variable.contains("fireball"))
                || (!classSpec.canStun() && variable.contains("stun"))) {
            errors.add(path + " is not allowed for " + classSpec.id());
        }
    }

    private void validateRoundTrainingLimits(List<String> errors, JsonNode metrics) {
        JsonNode trainingSamples = metrics.get("trainingSamples");
        if (trainingSamples != null && trainingSamples.isNumber()
                && trainingSamples.asInt() != 0) {
            errors.add("trainingMetrics.trainingSamples must be 0 for deterministic bot brains");
        }

        JsonNode epochsCompleted = metrics.get("epochsCompleted");
        if (epochsCompleted != null && epochsCompleted.isNumber()
                && epochsCompleted.asInt() != 0) {
            errors.add("trainingMetrics.epochsCompleted must be 0 for deterministic bot brains");
        }
    }

    private String computeModelHash(JsonNode model, List<String> errors) {
        try {
            return "sha256:" + sha256Hex(jsonMapper.writeValueAsString(model));
        } catch (Exception ex) {
            errors.add("modelHash could not be computed from submitted brain");
            return null;
        }
    }

    private JsonNode submittedBrain(ModelSubmissionPayloadDTO payload) {
        return payload.getBrain() != null ? payload.getBrain() : payload.getModel();
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    private void requireExact(List<String> errors, String value, String field, String expected) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        if (!expected.equals(value)) {
            errors.add(field + " must be " + expected);
        }
    }

    private void requireOneOf(List<String> errors, String value, String field, String... expectedValues) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        for (String expected : expectedValues) {
            if (expected.equals(value)) {
                return;
            }
        }

        errors.add(field + " is not supported");
    }

    private void requireText(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            errors.add(field + " is required");
        }
    }

    private void requireUuid(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            return;
        }

        try {
            UUID.fromString(value.trim());
        } catch (IllegalArgumentException ex) {
            errors.add(field + " must be a server-issued UUID");
        }
    }

    private boolean requireObject(List<String> errors, JsonNode value, String field) {
        if (value == null || value.isNull()) {
            errors.add(field + " is required");
            return false;
        }

        if (!value.isObject()) {
            errors.add(field + " must be an object");
            return false;
        }

        return true;
    }

    private void requireNonNegative(List<String> errors, Integer value, String field) {
        if (value == null) {
            errors.add(field + " is required");
            return;
        }

        rejectNegative(errors, value, field);
    }

    private void rejectNegative(List<String> errors, Integer value, String field) {
        if (value != null && value < 0) {
            errors.add(field + " cannot be negative");
        }
    }

    private void rejectTooLong(List<String> errors, String value, String field, int maxLength) {
        if (value != null && value.length() > maxLength) {
            errors.add(field + " cannot exceed " + maxLength + " characters");
        }
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
