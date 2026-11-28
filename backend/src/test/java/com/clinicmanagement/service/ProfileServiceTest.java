package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

import com.clinicmanagement.dto.ProfilePatchRequest;
import com.clinicmanagement.dto.UserProfileResponse;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class ProfileServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final ProfileService service = new ProfileService(users, mock(AuditLogService.class));

    @Test
    void getReturnsUserProfile() {
        User user = User.registerPatient("test@example.com", "hash", "Old Name");
        AuthenticatedUser viewer = new AuthenticatedUser(1L, "test@example.com", "Old Name", Role.PATIENT, UserStatus.ACTIVE);
        when(users.findById(1L)).thenReturn(Optional.of(user));

        UserProfileResponse res = service.get(viewer);
        assertThat(res.email()).isEqualTo("test@example.com");
        assertThat(res.fullName()).isEqualTo("Old Name");
    }

    @Test
    void updateModifiesProfileFields() {
        User user = User.registerPatient("test@example.com", "hash", "Old Name");
        AuthenticatedUser viewer = new AuthenticatedUser(1L, "test@example.com", "Old Name", Role.PATIENT, UserStatus.ACTIVE);
        when(users.findLocked(1L)).thenReturn(Optional.of(user));
        when(users.saveAndFlush(user)).thenReturn(user);

        UserProfileResponse res = service.update(viewer, new ProfilePatchRequest("New Name", "0901234567", "123 Street"));
        assertThat(res.fullName()).isEqualTo("New Name");
        assertThat(res.phone()).isEqualTo("0901234567");
        assertThat(res.address()).isEqualTo("123 Street");
        verify(users).saveAndFlush(user);
    }

    @Test
    void updateNormalizesBlankPhoneAndAddressToNull() {
        User user = User.registerPatient("test@example.com", "hash", "Old Name");
        AuthenticatedUser viewer = new AuthenticatedUser(1L, "test@example.com", "Old Name", Role.PATIENT, UserStatus.ACTIVE);
        when(users.findLocked(1L)).thenReturn(Optional.of(user));
        when(users.saveAndFlush(user)).thenReturn(user);

        UserProfileResponse res = service.update(viewer, new ProfilePatchRequest("New Name", "   ", ""));
        assertThat(res.fullName()).isEqualTo("New Name");
        assertThat(res.phone()).isNull();
        assertThat(res.address()).isNull();
        verify(users).saveAndFlush(user);
    }

    @Test
    void updateFailsOnBlankName() {
        AuthenticatedUser viewer = new AuthenticatedUser(1L, "test@example.com", "Old Name", Role.PATIENT, UserStatus.ACTIVE);
        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.update(viewer, new ProfilePatchRequest("   ")));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }
}
