package com.example.machiner.service;

import java.util.List;

public record ModelSubmissionValidationResult(List<String> errors) {

    public boolean isValid() {
        return errors.isEmpty();
    }
}
