package com.clinicmanagement.service;

import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.dto.PatientCreateRequest;
import com.clinicmanagement.dto.PatientPatchRequest;
import com.clinicmanagement.dto.PatientResponse;
import com.clinicmanagement.entity.Patient;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.PatientRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.LocalDate;
import java.util.Random;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
@PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR','PATIENT')")
public class PatientService {
    private final PatientRepository patients;
    private final UserRepository users;
    private final Random random = new Random();

    public PatientService(PatientRepository patients, UserRepository users) {
        this.patients = patients;
        this.users = users;
    }

    public PageResponse<PatientResponse> list(AuthenticatedUser viewer, String q, Boolean active, int page, int size) {
        if (viewer.role() != Role.ADMIN && viewer.role() != Role.RECEPTIONIST) {
            throw new AccessDeniedException("Access is denied.");
        }
        String like = CatalogQueries.like(q);
        Specification<Patient> search = (root, ignored, cb) -> cb.and(
                cb.or(
                        cb.like(cb.lower(root.get("patientCode")), like, '\\'),
                        cb.like(cb.lower(root.get("fullName")), like, '\\'),
                        cb.like(cb.lower(root.get("phone")), like, '\\')
                ),
                active == null ? cb.conjunction() : cb.equal(root.get("active"), active)
        );
        return PageResponse.from(patients.findAll(search, CatalogQueries.page(page, size, "patientCode"))
                .map(PatientResponse::from));
    }

    public PatientResponse get(AuthenticatedUser viewer, Long id) {
        if (viewer.role() == Role.DOCTOR) {
            throw new AccessDeniedException("Access is denied.");
        }
        Patient patient = patients.findById(id).orElseThrow(ManagementException::missing);
        if (viewer.role() == Role.PATIENT) {
            if (patient.getUser() == null || patient.getUser().getId() == null || !patient.getUser().getId().equals(viewer.id())) {
                throw ManagementException.missing();
            }
        }
        return PatientResponse.from(patient);
    }

    public PatientResponse getMePatientProfile(AuthenticatedUser viewer) {
        if (viewer.role() != Role.PATIENT) {
            throw new AccessDeniedException("Access is denied.");
        }
        Patient patient = patients.findByUserId(viewer.id()).orElseThrow(ManagementException::missing);
        return PatientResponse.from(patient);
    }

    @Transactional
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    public PatientResponse create(PatientCreateRequest request) {
        if (request.dateOfBirth() != null && request.dateOfBirth().isAfter(LocalDate.now())) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Date of birth cannot be in the future.");
        }
        if (request.fullName() == null || request.fullName().trim().isEmpty()) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Full name cannot be blank.");
        }

        String code = request.patientCode();
        if (code != null && !code.isBlank()) {
            if (patients.existsByPatientCode(code)) {
                throw ManagementException.conflict("PATIENT_CODE_EXISTS", "Patient code already exists.");
            }
        } else {
            code = generatePatientCode();
        }

        User user = null;
        if (request.userId() != null) {
            user = users.findLocked(request.userId()).orElseThrow(ManagementException::missing);
            validateLinkedUser(user);
            if (patients.existsByUserId(user.getId())) {
                throw ManagementException.conflict("USER_ALREADY_LINKED", "User already has a patient profile.");
            }
        }

        Patient patient = new Patient(user, code, request.fullName(), request.dateOfBirth(), request.sex(),
                request.phone(), request.address(), request.isActive() == null || request.isActive());
        return save(patient);
    }

    @Transactional
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    public PatientResponse patch(Long id, PatientPatchRequest request) {
        if (request.userId() == null && request.patientCode() == null && request.fullName() == null
                && request.dateOfBirth() == null && request.sex() == null && request.phone() == null
                && request.address() == null && request.isActive() == null) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "No fields to update.");
        }

        Patient patient = patients.findLocked(id).orElseThrow(ManagementException::missing);

        if (request.fullName() != null) {
            if (request.fullName().trim().isEmpty()) {
                throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Full name cannot be blank.");
            }
            patient.setFullName(request.fullName().trim());
        }

        if (request.dateOfBirth() != null) {
            if (request.dateOfBirth().isAfter(LocalDate.now())) {
                throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Date of birth cannot be in the future.");
            }
            patient.setDateOfBirth(request.dateOfBirth());
        }

        if (request.sex() != null) {
            patient.setSex(request.sex());
        }

        if (request.phone() != null) {
            patient.setPhone(request.phone());
        }

        if (request.address() != null) {
            patient.setAddress(request.address());
        }

        if (request.isActive() != null) {
            patient.setActive(request.isActive());
        }

        if (request.patientCode() != null) {
            if (patients.existsByPatientCodeAndIdNot(request.patientCode(), id)) {
                throw ManagementException.conflict("PATIENT_CODE_EXISTS", "Patient code already exists.");
            }
            patient.setPatientCode(request.patientCode());
        }

        if (request.userId() != null) {
            User user = users.findLocked(request.userId()).orElseThrow(ManagementException::missing);
            validateLinkedUser(user);
            if (patients.existsByUserIdAndIdNot(user.getId(), id)) {
                throw ManagementException.conflict("USER_ALREADY_LINKED", "User already has a patient profile.");
            }
            patient.setUser(user);
        }

        return save(patient);
    }

    private void validateLinkedUser(User user) {
        if (user.getRole() != Role.PATIENT) {
            throw ManagementException.conflict("USER_NOT_ELIGIBLE", "Linked user must have role PATIENT.");
        }
        if (user.getStatus() != UserStatus.ACTIVE) {
            throw ManagementException.conflict("USER_NOT_ACTIVE", "Linked user must be active.");
        }
    }

    private String generatePatientCode() {
        for (int i = 0; i < 20; i++) {
            String candidate = "PAT" + (100000 + random.nextInt(900000));
            if (!patients.existsByPatientCode(candidate)) {
                return candidate;
            }
        }
        return "PAT" + System.currentTimeMillis();
    }

    private PatientResponse save(Patient patient) {
        try {
            return PatientResponse.from(patients.saveAndFlush(patient));
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("PATIENT_CONFLICT", "Patient conflicts with existing data.");
        }
    }
}
