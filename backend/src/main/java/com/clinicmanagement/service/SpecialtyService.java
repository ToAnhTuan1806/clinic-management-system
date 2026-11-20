package com.clinicmanagement.service;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.Specialty;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.DoctorRepository;
import com.clinicmanagement.repository.SpecialtyRepository;
import com.clinicmanagement.security.AuthenticatedUser;
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
public class SpecialtyService {
    private final SpecialtyRepository specialties;
    private final DoctorRepository doctors;

    public SpecialtyService(SpecialtyRepository specialties, DoctorRepository doctors) {
        this.specialties = specialties;
        this.doctors = doctors;
    }

    public PageResponse<SpecialtyResponse> list(AuthenticatedUser viewer, String q, Boolean active, int page, int size) {
        boolean restricted = viewer.role() == Role.PATIENT || viewer.role() == Role.DOCTOR;
        if (restricted && Boolean.FALSE.equals(active)) {
            throw new AccessDeniedException("Access is denied.");
        }
        String like = CatalogQueries.like(q);
        Specification<Specialty> query = (root, ignored, cb) -> cb.and(
                cb.or(cb.like(cb.lower(root.get("code")), like, '\\'), cb.like(cb.lower(root.get("name")), like, '\\')),
                restricted || active != null ? cb.equal(root.get("active"), restricted || active) : cb.conjunction());
        return PageResponse.from(specialties.findAll(query, CatalogQueries.page(page, size, "code"))
                .map(SpecialtyResponse::from));
    }

    public SpecialtyResponse get(AuthenticatedUser viewer, Long id) {
        Specialty specialty = specialties.findById(id).orElseThrow(ManagementException::missing);
        if ((viewer.role() == Role.PATIENT || viewer.role() == Role.DOCTOR) && !specialty.isActive()) {
            throw ManagementException.missing();
        }
        return SpecialtyResponse.from(specialty);
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public SpecialtyResponse create(SpecialtyCreateRequest request) {
        unique(request.code(), request.name(), 0L);
        return save(new Specialty(request.code(), request.name(), CatalogValues.optionalText(request.description()),
                request.isActive() == null || request.isActive()));
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public SpecialtyResponse patch(Long id, SpecialtyPatchRequest request) {
        if (request.code() == null && request.name() == null && request.description() == null && request.isActive() == null) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "No fields to update.");
        }
        Specialty specialty = specialties.findLocked(id).orElseThrow(ManagementException::missing);
        String code = request.code() == null ? specialty.getCode() : request.code();
        String name = request.name() == null ? specialty.getName() : request.name();
        boolean active = request.isActive() == null ? specialty.isActive() : request.isActive();
        if (!active && doctors.existsBySpecialtyIdAndActiveTrue(id)) {
            throw ManagementException.conflict("SPECIALTY_HAS_ACTIVE_DOCTORS", "Specialty still has active doctors.");
        }
        unique(code, name, id);
        specialty.update(code, name, request.description() == null ? specialty.getDescription()
                : CatalogValues.optionalText(request.description()), active);
        return save(specialty);
    }

    private void unique(String code, String name, Long excluded) {
        if (specialties.existsByCodeAndIdNot(code, excluded)) {
            throw ManagementException.conflict("SPECIALTY_CODE_EXISTS", "Specialty code already exists.");
        }
        if (specialties.existsByNameIgnoreCaseAndIdNot(name, excluded)) {
            throw ManagementException.conflict("SPECIALTY_NAME_EXISTS", "Specialty name already exists.");
        }
    }

    private SpecialtyResponse save(Specialty specialty) {
        try {
            return SpecialtyResponse.from(specialties.saveAndFlush(specialty));
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("SPECIALTY_CONFLICT", "Specialty conflicts with existing data.");
        }
    }
}
