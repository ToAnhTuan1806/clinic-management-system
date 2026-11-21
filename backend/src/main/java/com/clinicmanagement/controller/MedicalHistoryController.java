package com.clinicmanagement.controller;

import com.clinicmanagement.dto.ApiResponse;
import com.clinicmanagement.dto.MedicalHistoryItem;
import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.MedicalRecordService;
import jakarta.validation.constraints.Positive;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/patients")
public class MedicalHistoryController {
    private final MedicalRecordService records;

    public MedicalHistoryController(MedicalRecordService records) {
        this.records = records;
    }

    @GetMapping("/{id}/medical-history")
    public ResponseEntity<ApiResponse<PageResponse<MedicalHistoryItem>>> history(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(records.history(viewer, id, page, size)));
    }
}
