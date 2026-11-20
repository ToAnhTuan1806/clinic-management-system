package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Specialty;

public record SpecialtyResponse(String id, String code, String name, String description, boolean isActive) {
    public static SpecialtyResponse from(Specialty specialty) {
        return new SpecialtyResponse(specialty.getId().toString(), specialty.getCode(), specialty.getName(),
                specialty.getDescription(), specialty.isActive());
    }
}
