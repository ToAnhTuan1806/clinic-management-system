package com.clinicmanagement.service;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.*;
import com.clinicmanagement.security.AuthenticatedUser;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;
import java.util.List;
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
public class DoctorService {
    private final DoctorRepository doctors;
    private final SpecialtyRepository specialties;
    private final UserRepository users;

    public DoctorService(DoctorRepository doctors, SpecialtyRepository specialties, UserRepository users) {
        this.doctors = doctors;
        this.specialties = specialties;
        this.users = users;
    }

    public PageResponse<DoctorView> list(AuthenticatedUser viewer, String q, Long specialtyId,
                                          Boolean active, int page, int size) {
        if (viewer.role() == Role.PATIENT && Boolean.FALSE.equals(active)) {
            throw new AccessDeniedException("Access is denied.");
        }
        String like = CatalogQueries.like(q);
        Specification<Doctor> search = (root, ignored, cb) -> cb.and(
                cb.or(cb.like(cb.lower(root.get("doctorCode")), like, '\\'),
                        cb.like(cb.lower(root.get("user").get("fullName")), like, '\\')),
                specialtyId == null ? cb.conjunction() : cb.equal(root.get("specialty").get("id"), specialtyId),
                active == null ? cb.conjunction() : cb.equal(root.get("active"), active));
        return PageResponse.from(doctors.findAll(scope(viewer).and(search), CatalogQueries.page(page, size, "doctorCode"))
                .map(doctor -> DoctorView.from(doctor, viewer.role())));
    }

    public DoctorView get(AuthenticatedUser viewer, Long id) {
        Specification<Doctor> idQuery = (root, ignored, cb) -> cb.equal(root.get("id"), id);
        return DoctorView.from(doctors.findOne(scope(viewer).and(idQuery)).orElseThrow(ManagementException::missing), viewer.role());
    }

    private Specification<Doctor> scope(AuthenticatedUser viewer) {
        return (root, ignored, cb) -> {
            if (viewer.role() == Role.DOCTOR) {
                return cb.equal(root.get("user").get("id"), viewer.id());
            }
            if (viewer.role() == Role.PATIENT) {
                return cb.and(cb.isTrue(root.get("active")), cb.isTrue(root.get("specialty").get("active")),
                        cb.equal(root.get("user").get("status"), UserStatus.ACTIVE),
                        cb.equal(root.get("user").get("role"), Role.DOCTOR));
            }
            return cb.conjunction();
        };
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public DoctorView create(DoctorCreateRequest request) {
        // All profile writers lock specialty -> user -> doctor; disabling a specialty uses the same parent lock.
        Specialty specialty = specialties.findLocked(request.specialtyId()).orElseThrow(ManagementException::missing);
        User user = users.findLocked(request.userId()).orElseThrow(ManagementException::missing);
        activeSpecialty(specialty);
        eligible(user);
        if (doctors.existsByUserId(user.getId())) {
            throw ManagementException.conflict("USER_ALREADY_LINKED", "User already has a doctor profile.");
        }
        String license = CatalogValues.optionalText(CatalogValues.code(request.licenseNumber()));
        unique(request.doctorCode(), license, 0L);
        return save(new Doctor(user, specialty, request.doctorCode(), license,
                CatalogValues.optionalText(request.biography()), request.isActive() == null || request.isActive()));
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public DoctorView patch(Long id, DoctorPatchRequest request) {
        if (request.specialtyId() == null && request.doctorCode() == null && request.licenseNumber() == null
                && request.biography() == null && request.isActive() == null) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "No fields to update.");
        }
        DoctorRepository.Links links = doctors.findLinks(id).orElseThrow(ManagementException::missing);
        Long targetId = request.specialtyId() == null ? links.getSpecialtyId() : request.specialtyId();
        Map<Long, Specialty> locked = new HashMap<>();
        for (Long specialtyId : new TreeSet<>(List.of(links.getSpecialtyId(), targetId))) {
            locked.put(specialtyId, specialties.findLocked(specialtyId).orElseThrow(ManagementException::missing));
        }
        User user = users.findLocked(links.getUserId()).orElseThrow(ManagementException::missing);
        Doctor doctor = doctors.findLocked(id).orElseThrow(ManagementException::missing);
        if (!doctor.getSpecialty().getId().equals(links.getSpecialtyId()) || !doctor.getUser().getId().equals(links.getUserId())) {
            throw ManagementException.conflict("DOCTOR_CONCURRENT_UPDATE", "Doctor changed; reload and retry.");
        }
        if (!Boolean.FALSE.equals(request.isActive())) {
            eligible(user);
        }
        Specialty target = locked.get(targetId);
        if (!targetId.equals(links.getSpecialtyId()) || Boolean.TRUE.equals(request.isActive())) {
            activeSpecialty(target);
        }
        String code = request.doctorCode() == null ? doctor.getDoctorCode() : request.doctorCode();
        String license = request.licenseNumber() == null ? doctor.getLicenseNumber()
                : CatalogValues.optionalText(CatalogValues.code(request.licenseNumber()));
        unique(code, license, id);
        doctor.update(target, code, license, request.biography() == null ? doctor.getBiography()
                : CatalogValues.optionalText(request.biography()), request.isActive() == null ? doctor.isActive() : request.isActive());
        return save(doctor);
    }

    private void activeSpecialty(Specialty specialty) {
        if (!specialty.isActive()) {
            throw ManagementException.conflict("SPECIALTY_INACTIVE", "Specialty is inactive.");
        }
    }

    private void eligible(User user) {
        if (user.getRole() != Role.DOCTOR || user.getStatus() != UserStatus.ACTIVE) {
            throw ManagementException.conflict("USER_NOT_ELIGIBLE", "User must be an active doctor account.");
        }
    }

    private void unique(String code, String license, Long excluded) {
        if (doctors.existsByDoctorCodeAndIdNot(code, excluded)) {
            throw ManagementException.conflict("DOCTOR_CODE_EXISTS", "Doctor code already exists.");
        }
        if (license != null && doctors.existsByLicenseNumberAndIdNot(license, excluded)) {
            throw ManagementException.conflict("LICENSE_NUMBER_EXISTS", "License number already exists.");
        }
    }

    private DoctorView save(Doctor doctor) {
        try {
            return DoctorView.from(doctors.saveAndFlush(doctor), Role.ADMIN);
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("DOCTOR_CONFLICT", "Doctor conflicts with existing data.");
        }
    }
}
