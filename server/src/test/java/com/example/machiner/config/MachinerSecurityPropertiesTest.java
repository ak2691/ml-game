package com.example.machiner.config;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class MachinerSecurityPropertiesTest {

    @Test
    void credentialedCorsRejectsWildcardOrigins() {
        MachinerSecurityProperties properties = new MachinerSecurityProperties();

        assertThatThrownBy(() -> properties.setAllowedOrigins(List.of("*")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void productionOriginsMustUseHttps() {
        MachinerSecurityProperties properties = new MachinerSecurityProperties();
        properties.setAllowedOrigins(List.of("http://app.example.test"));
        properties.setRequireHttps(true);

        assertThatThrownBy(properties::validate)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Production allowed origins must use HTTPS");
    }
}
