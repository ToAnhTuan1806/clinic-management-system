package com.clinicmanagement.controller;

import com.clinicmanagement.dto.ApiResponse;
import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.dto.PatientCreateRequest;
import com.clinicmanagement.dto.PatientPatchRequest;
import com.clinicmanagement.dto.PatientResponse;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.PatientService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class PatientController {
    private final PatientService patients;

    public PatientController(PatientService patients) {
        this.patients = patients;
    }

    @GetMapping("/patients")
    public ApiResponse<PageResponse<PatientResponse>> list(
            @AuthenticationPrincipal AuthenticatedUser viewer,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean isActive,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return new ApiResponse<>(patients.list(viewer, q, isActive, page, size));
    }

    @GetMapping("/patients/{id}")
    public ApiResponse<PatientResponse> get(
            @AuthenticationPrincipal AuthenticatedUser viewer,
            @PathVariable @Positive Long id) {
        return new ApiResponse<>(patients.get(viewer, id));
    }

    @PostMapping("/patients")
    public ResponseEntity<ApiResponse<PatientResponse>> create(
            @Valid @RequestBody PatientCreateRequest request) {
        PatientResponse created = patients.create(request);
        return ResponseEntity.created(URI.create("/api/v1/patients/" + created.id()))
                .body(new ApiResponse<>(created));
    }

    @PatchMapping("/patients/{id}")
    public ApiResponse<PatientResponse> patch(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PatientPatchRequest request) {
        return new ApiResponse<>(patients.patch(id, request));
    }

    @GetMapping("/me/patient-profile")
    public ApiResponse<PatientResponse> mePatientProfile(
            @AuthenticationPrincipal AuthenticatedUser viewer) {
        return new ApiResponse<>(patients.getMePatientProfile(viewer));
    }
}
