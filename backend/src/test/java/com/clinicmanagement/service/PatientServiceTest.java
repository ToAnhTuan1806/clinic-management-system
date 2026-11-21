package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

import com.clinicmanagement.dto.PatientCreateRequest;
import com.clinicmanagement.dto.PatientPatchRequest;
import com.clinicmanagement.entity.Patient;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.Sex;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.PatientRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;

class PatientServiceTest {
    private final PatientRepository patients = mock(PatientRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final PatientService service = new PatientService(patients, users);

    @Test
    void doctorCannotAccessPatientList() {
        AuthenticatedUser doctor = new AuthenticatedUser(2L, "doc@test.com", "Doctor", Role.DOCTOR, UserStatus.ACTIVE);
        assertThrows(AccessDeniedException.class, () -> service.list(doctor, "", null, 0, 10));
    }

    @Test
    void patientCannotAccessPatientList() {
        AuthenticatedUser patient = new AuthenticatedUser(3L, "pat@test.com", "Patient", Role.PATIENT, UserStatus.ACTIVE);
        assertThrows(AccessDeniedException.class, () -> service.list(patient, "", null, 0, 10));
    }

    @Test
    void doctorCannotGetPatientByIdWithoutAssignment() {
        AuthenticatedUser doctor = new AuthenticatedUser(2L, "doc@test.com", "Doctor", Role.DOCTOR, UserStatus.ACTIVE);
        assertThrows(AccessDeniedException.class, () -> service.get(doctor, 100L));
    }

    @Test
    void patientCannotViewOtherPatientProfile() {
        AuthenticatedUser patient = new AuthenticatedUser(3L, "pat@test.com", "Patient", Role.PATIENT, UserStatus.ACTIVE);
        User otherUser = User.registerPatient("other@test.com", "hash", "Other");
        Patient otherPatient = new Patient(otherUser, "PT_OTHER", "Other", null, Sex.FEMALE, null, null, true);
        when(patients.findById(100L)).thenReturn(Optional.of(otherPatient));

        ManagementException ex = assertThrows(ManagementException.class, () -> service.get(patient, 100L));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void createRejectsFutureBirthDate() {
        PatientCreateRequest req = new PatientCreateRequest(null, "PT_01", "Future Person",
                LocalDate.now().plusDays(2), Sex.MALE, "0912345678", "Addr", true);
        ManagementException ex = assertThrows(ManagementException.class, () -> service.create(req));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void createRejectsDuplicateCode() {
        when(patients.existsByPatientCode("PT_EXISTS")).thenReturn(true);
        PatientCreateRequest req = new PatientCreateRequest(null, "PT_EXISTS", "Dup Person",
                LocalDate.now().minusYears(20), Sex.MALE, "0912345678", "Addr", true);
        ManagementException ex = assertThrows(ManagementException.class, () -> service.create(req));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("PATIENT_CODE_EXISTS");
    }

    @Test
    void patchRejectsEmptyUpdate() {
        PatientPatchRequest req = new PatientPatchRequest(null, null, null, null, null, null, null, null);
        ManagementException ex = assertThrows(ManagementException.class, () -> service.patch(1L, req));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }
}
