package com.clinicmanagement.controller;

import com.clinicmanagement.dto.ApiResponse;
import com.clinicmanagement.dto.MedicalRecordCompletionRequest;
import com.clinicmanagement.dto.MedicalRecordCreateRequest;
import com.clinicmanagement.dto.MedicalRecordPatchRequest;
import com.clinicmanagement.dto.MedicalRecordView;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.MedicalRecordService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import java.net.URI;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/medical-records")
public class MedicalRecordController {
    private final MedicalRecordService records;

    public MedicalRecordController(MedicalRecordService records) {
        this.records = records;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<MedicalRecordView.Clinical>> create(
            @AuthenticationPrincipal AuthenticatedUser viewer, @Valid @RequestBody MedicalRecordCreateRequest request) {
        var created = records.create(viewer, request.appointmentId());
        return ResponseEntity.created(URI.create("/api/v1/medical-records/" + created.metadata().id()))
                .cacheControl(CacheControl.noStore()).body(new ApiResponse<>(created));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<MedicalRecordView>> get(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ApiResponse<>(records.get(viewer, id)));
    }

    @GetMapping("/by-appointment/{id}")
    public ResponseEntity<ApiResponse<MedicalRecordView>> getByAppointment(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(records.getByAppointment(viewer, id)));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ApiResponse<MedicalRecordView.Clinical>> patch(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id,
            @Valid @RequestBody MedicalRecordPatchRequest request) {
        return clinical(records.patch(viewer, id, request));
    }

    @PostMapping("/{id}/completion")
    public ResponseEntity<ApiResponse<MedicalRecordView.Clinical>> complete(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id,
            @Valid @RequestBody MedicalRecordCompletionRequest request) {
        return clinical(records.complete(viewer, id, request.expectedVersion()));
    }

    private static ResponseEntity<ApiResponse<MedicalRecordView.Clinical>> clinical(MedicalRecordView.Clinical record) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ApiResponse<>(record));
    }
}
