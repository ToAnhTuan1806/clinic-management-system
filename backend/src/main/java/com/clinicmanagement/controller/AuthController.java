package com.clinicmanagement.controller;

import com.clinicmanagement.dto.ApiResponse;
import com.clinicmanagement.dto.GoogleLoginRequest;
import com.clinicmanagement.dto.LoginRequest;
import com.clinicmanagement.dto.LoginResponse;
import com.clinicmanagement.dto.RegisterRequest;
import com.clinicmanagement.dto.UserResponse;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.AuthService;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<UserResponse>> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.created(URI.create("/api/v1/auth/me")).cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(auth.register(request)));
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ApiResponse<>(auth.login(request)));
    }

    @PostMapping("/google")
    public ResponseEntity<ApiResponse<LoginResponse>> loginWithGoogle(@Valid @RequestBody GoogleLoginRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ApiResponse<>(auth.loginWithGoogle(request)));
    }

    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> me(@AuthenticationPrincipal AuthenticatedUser user) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ApiResponse<>(UserResponse.from(user)));
    }
}
