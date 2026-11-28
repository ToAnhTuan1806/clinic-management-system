package com.clinicmanagement.service;

import com.clinicmanagement.dto.PrescriptionItemRequest;
import com.clinicmanagement.dto.PrescriptionPutRequest;
import com.clinicmanagement.dto.PrescriptionResponse;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.AppointmentRepository;
import com.clinicmanagement.repository.MedicalRecordRepository;
import com.clinicmanagement.repository.PrescriptionRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;

@Service
public class PrescriptionService {
    private final PrescriptionRepository prescriptions;
    private final MedicalRecordRepository records;
    private final AppointmentRepository appointments;
    private final UserRepository users;
    private final Clock clock;
    private final EntityManager entityManager;

    public PrescriptionService(PrescriptionRepository prescriptions,
                               MedicalRecordRepository records,
                               AppointmentRepository appointments,
                               UserRepository users,
                               Clock clock,
                               EntityManager entityManager) {
        this.prescriptions = prescriptions;
        this.records = records;
        this.appointments = appointments;
        this.users = users;
        this.clock = clock;
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('DOCTOR', 'PATIENT')")
    public PrescriptionResponse get(AuthenticatedUser viewer, Long medicalRecordId) {
        MedicalRecord record = records.findById(medicalRecordId).orElseThrow(ManagementException::missing);
        Appointment appointment = record.getAppointment();

        boolean editable = false;
        switch (viewer.role()) {
            case DOCTOR -> {
                requireAssigned(viewer, appointment);
                editable = (appointment.getStatus() == AppointmentStatus.IN_PROGRESS && record.getCompletedAt() == null);
            }
            case PATIENT -> {
                User owner = appointment.getPatient().getUser();
                if (appointment.getStatus() != AppointmentStatus.COMPLETED
                        || record.getCompletedAt() == null
                        || record.getReleasedAt() == null
                        || record.getReleasedBy() == null
                        || owner == null
                        || !viewer.id().equals(owner.getId())) {
                    throw ManagementException.missing();
                }
                editable = false;
            }
            default -> throw new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Access is denied.");
        }

        Optional<Prescription> prescriptionOpt = prescriptions.findByMedicalRecordId(medicalRecordId);
        if (prescriptionOpt.isEmpty()) {
            return PrescriptionResponse.empty(medicalRecordId, record.getVersion(), editable);
        }
        return PrescriptionResponse.from(prescriptionOpt.get(), record.getVersion(), editable);
    }

    // The lookup before locking must not pin a stale MySQL repeatable-read snapshot.
    @Transactional(isolation = Isolation.READ_COMMITTED)
    @PreAuthorize("hasRole('DOCTOR')")
    public PrescriptionResponse put(AuthenticatedUser viewer, Long medicalRecordId, PrescriptionPutRequest request) {
        Long appointmentId = records.findAppointmentId(medicalRecordId).orElseThrow(ManagementException::missing);
        Appointment appointment = appointments.findLockedForExamination(appointmentId).orElseThrow(ManagementException::missing);
        entityManager.refresh(appointment, LockModeType.PESSIMISTIC_WRITE);
        requireAssigned(viewer, appointment);
        requireStatus(appointment, AppointmentStatus.IN_PROGRESS);

        MedicalRecord record = records.findLocked(medicalRecordId).orElseThrow(ManagementException::missing);
        entityManager.refresh(record, LockModeType.PESSIMISTIC_WRITE);

        if (record.getCompletedAt() != null) {
            throw ManagementException.conflict("INVALID_STATE_TRANSITION", "Medical record is already completed.");
        }
        if (!record.getVersion().equals(request.expectedVersion())) {
            throw versionConflict();
        }

        validateItems(request);

        Instant now = clock.instant();

        Prescription prescription = prescriptions.findByMedicalRecordId(medicalRecordId)
                .orElseGet(() -> new Prescription(record, users.getReferenceById(viewer.id()), now));

        try {
            prescription.clearItems();
            // Delete old positions before inserting replacements under the V11 unique key.
            // Touch the record only afterwards so the operation advances its version once.
            if (prescription.getId() != null) prescriptions.flush();
            prescription.touch(now);

            if (request.items() != null) {
                for (int i = 0; i < request.items().size(); i++) {
                    PrescriptionItemRequest itemReq = request.items().get(i);
                    PrescriptionItem item = new PrescriptionItem(
                            itemReq.medicationName().strip(),
                            itemReq.quantity(),
                            itemReq.dosage().strip(),
                            itemReq.frequency().strip(),
                            itemReq.durationDays(),
                            itemReq.instructions() != null && !itemReq.instructions().isBlank() ? itemReq.instructions().strip() : null,
                            i
                    );
                    prescription.addItem(item);
                }
            }

            record.touch(now);

            prescriptions.save(prescription);
            prescriptions.flush();
            records.flush();
            return PrescriptionResponse.from(prescription, record.getVersion(), true);
        } catch (ObjectOptimisticLockingFailureException exception) {
            throw versionConflict();
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("PRESCRIPTION_CONFLICT", "Prescription could not be saved.");
        }
    }

    private static void validateItems(PrescriptionPutRequest request) {
        if (request.items() == null) {
            throw validation("Items list is required.");
        }
        if (request.items().size() > 50) {
            throw validation("Maximum 50 items allowed.");
        }
        for (PrescriptionItemRequest item : request.items()) {
            if (item == null) throw validation("Prescription items must not be null.");
            if (item.medicationName() == null || item.medicationName().isBlank() || item.medicationName().strip().length() > 200) {
                throw validation("Medication name must be non-blank and at most 200 characters.");
            }
            if (item.quantity() == null || item.quantity() < 1 || item.quantity() > 10000) {
                throw validation("Quantity must be between 1 and 10000.");
            }
            if (item.dosage() == null || item.dosage().isBlank() || item.dosage().strip().length() > 100) {
                throw validation("Dosage must be non-blank and at most 100 characters.");
            }
            if (item.frequency() == null || item.frequency().isBlank() || item.frequency().strip().length() > 100) {
                throw validation("Frequency must be non-blank and at most 100 characters.");
            }
            if (item.durationDays() == null || item.durationDays() < 1 || item.durationDays() > 365) {
                throw validation("Duration days must be between 1 and 365.");
            }
            if (item.instructions() != null && item.instructions().length() > 1000) {
                throw validation("Instructions must be at most 1000 characters.");
            }
        }
    }

    private static void requireAssigned(AuthenticatedUser viewer, Appointment appointment) {
        if (!viewer.id().equals(appointment.getDoctor().getUser().getId())) {
            throw ManagementException.missing();
        }
    }

    private static void requireStatus(Appointment appointment, AppointmentStatus status) {
        if (appointment.getStatus() != status) {
            throw ManagementException.conflict("INVALID_STATE_TRANSITION", "Appointment is not in the required state.");
        }
    }

    private static ManagementException versionConflict() {
        return ManagementException.conflict("VERSION_CONFLICT", "Medical record or appointment has changed.");
    }

    private static ManagementException validation(String message) {
        return new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }
}
