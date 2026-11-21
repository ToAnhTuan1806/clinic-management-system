package com.clinicmanagement.service;

import com.clinicmanagement.dto.ProfilePatchRequest;
import com.clinicmanagement.dto.UserProfileResponse;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
@PreAuthorize("hasAnyRole('ADMIN','DOCTOR','RECEPTIONIST','PATIENT')")
public class ProfileService {
    private final UserRepository users;

    public ProfileService(UserRepository users) {
        this.users = users;
    }

    public UserProfileResponse get(AuthenticatedUser viewer) {
        User user = users.findById(viewer.id()).orElseThrow(ManagementException::missing);
        return UserProfileResponse.from(user);
    }

    @Transactional
    public UserProfileResponse update(AuthenticatedUser viewer, ProfilePatchRequest request) {
        if (request.fullName() == null || request.fullName().trim().isEmpty()) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Full name cannot be blank.");
        }
        User user = users.findLocked(viewer.id()).orElseThrow(ManagementException::missing);
        user.updateProfile(request.fullName(), request.phone(), request.address());
        return UserProfileResponse.from(users.saveAndFlush(user));
    }
}
