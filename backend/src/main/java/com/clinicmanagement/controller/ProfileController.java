package com.clinicmanagement.controller;

import com.clinicmanagement.dto.ApiResponse;
import com.clinicmanagement.dto.ProfilePatchRequest;
import com.clinicmanagement.dto.UserProfileResponse;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.ProfileService;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/me/profile")
public class ProfileController {
    private final ProfileService profiles;

    public ProfileController(ProfileService profiles) {
        this.profiles = profiles;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<UserProfileResponse>> get(@AuthenticationPrincipal AuthenticatedUser viewer) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(profiles.get(viewer)));
    }

    @PatchMapping
    public ResponseEntity<ApiResponse<UserProfileResponse>> patch(
            @AuthenticationPrincipal AuthenticatedUser viewer,
            @Valid @RequestBody ProfilePatchRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(profiles.update(viewer, request)));
    }
}
