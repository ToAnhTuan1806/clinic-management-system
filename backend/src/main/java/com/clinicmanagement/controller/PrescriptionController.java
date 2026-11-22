package com.clinicmanagement.controller;

import com.clinicmanagement.dto.ApiResponse;
import com.clinicmanagement.dto.PrescriptionPutRequest;
import com.clinicmanagement.dto.PrescriptionResponse;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.PrescriptionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/medical-records/{id}/prescription")
public class PrescriptionController {
    private final PrescriptionService prescriptions;

    public PrescriptionController(PrescriptionService prescriptions) {
        this.prescriptions = prescriptions;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<PrescriptionResponse>> get(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(prescriptions.get(viewer, id)));
    }

    @PutMapping
    public ResponseEntity<ApiResponse<PrescriptionResponse>> put(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id,
            @Valid @RequestBody PrescriptionPutRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(prescriptions.put(viewer, id, request)));
    }
}
