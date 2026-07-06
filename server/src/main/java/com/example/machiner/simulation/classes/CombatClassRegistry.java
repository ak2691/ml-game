package com.example.machiner.simulation.classes;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class CombatClassRegistry {

    private final Map<String, CombatClassSpec> specs;
    private final CombatClassSpec fallback;

    public CombatClassRegistry(List<CombatClassSpec> specs) {
        if (specs == null || specs.isEmpty()) {
            throw new IllegalArgumentException("At least one combat class spec is required");
        }
        this.specs = specs.stream()
                .collect(Collectors.toUnmodifiableMap(CombatClassSpec::id, Function.identity()));
        this.fallback = this.specs.getOrDefault("melee", specs.getFirst());
    }

    public CombatClassSpec forId(String id) {
        return specs.getOrDefault(id, fallback);
    }
}
