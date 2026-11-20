package com.clinicmanagement.controller;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.SpecialtyService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/specialties")
public class SpecialtyController {
    private final SpecialtyService specialties;
    public SpecialtyController(SpecialtyService specialties) { this.specialties = specialties; }

    @GetMapping
    public ApiResponse<PageResponse<SpecialtyResponse>> list(@AuthenticationPrincipal AuthenticatedUser viewer,
            @RequestParam(required = false) String q, @RequestParam(required = false) Boolean isActive,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return new ApiResponse<>(specialties.list(viewer, q, isActive, page, size));
    }

    @GetMapping("/{id}")
    public ApiResponse<SpecialtyResponse> get(@AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id) {
        return new ApiResponse<>(specialties.get(viewer, id));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<SpecialtyResponse>> create(@Valid @RequestBody SpecialtyCreateRequest request) {
        SpecialtyResponse created = specialties.create(request);
        return ResponseEntity.created(URI.create("/api/v1/specialties/" + created.id())).body(new ApiResponse<>(created));
    }

    @PatchMapping("/{id}")
    public ApiResponse<SpecialtyResponse> patch(@PathVariable @Positive Long id, @Valid @RequestBody SpecialtyPatchRequest request) {
        return new ApiResponse<>(specialties.patch(id, request));
    }
}
