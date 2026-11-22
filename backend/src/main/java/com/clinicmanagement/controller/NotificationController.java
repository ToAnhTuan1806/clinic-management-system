package com.clinicmanagement.controller;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.NotificationService;
import jakarta.validation.constraints.Positive;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {
    private final NotificationService notifications;
    public NotificationController(NotificationService notifications) { this.notifications = notifications; }

    @GetMapping
    public ResponseEntity<ApiResponse<NotificationPageResponse>> list(
            @AuthenticationPrincipal AuthenticatedUser viewer, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(notifications.list(viewer, page, size)));
    }

    @PatchMapping("/{id}/read")
    public ResponseEntity<ApiResponse<NotificationResponse>> read(
            @AuthenticationPrincipal AuthenticatedUser viewer, @PathVariable @Positive Long id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(notifications.read(viewer, id)));
    }
}
