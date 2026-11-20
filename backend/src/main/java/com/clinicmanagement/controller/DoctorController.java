package com.clinicmanagement.controller;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.DoctorService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/doctors")
public class DoctorController {
    private final DoctorService doctors;
    public DoctorController(DoctorService doctors) { this.doctors = doctors; }

    @GetMapping
    public ApiResponse<PageResponse<DoctorView>> list(@AuthenticationPrincipal AuthenticatedUser viewer,
            @RequestParam(required = false) String q, @RequestParam(required = false) @Positive Long specialtyId,
            @RequestParam(required = false) Boolean isActive, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return new ApiResponse<>(doctors.list(viewer, q, specialtyId, isActive, page, size));
    }

    @GetMapping("/{id}")
    public ApiResponse<DoctorView> get(@AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id) {
        return new ApiResponse<>(doctors.get(viewer, id));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<DoctorView>> create(@Valid @RequestBody DoctorCreateRequest request) {
        DoctorView.Internal created = (DoctorView.Internal) doctors.create(request);
        return ResponseEntity.created(URI.create("/api/v1/doctors/" + created.id())).body(new ApiResponse<>(created));
    }

    @PatchMapping("/{id}")
    public ApiResponse<DoctorView> patch(@PathVariable @Positive Long id, @Valid @RequestBody DoctorPatchRequest request) {
        return new ApiResponse<>(doctors.patch(id, request));
    }
}
