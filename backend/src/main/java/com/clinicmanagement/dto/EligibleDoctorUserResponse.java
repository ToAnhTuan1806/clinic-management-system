package com.clinicmanagement.dto;

/** Minimal ADMIN-only selection projection; no entity or credential fields are serialized. */
public record EligibleDoctorUserResponse(String id, String fullName, String email) {
    public EligibleDoctorUserResponse(Long id, String fullName, String email) {
        this(id.toString(), fullName, email);
    }
}
