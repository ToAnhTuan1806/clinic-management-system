package com.clinicmanagement.service;

import com.clinicmanagement.dto.MedicalRecordPatchRequest;
import com.clinicmanagement.dto.MedicalRecordView;
import com.clinicmanagement.dto.MedicalHistoryItem;
import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.repository.PatientRepository;
import org.springframework.data.domain.PageRequest;
import com.clinicmanagement.entity.Appointment;
import com.clinicmanagement.entity.AppointmentStatus;
import com.clinicmanagement.entity.MedicalRecord;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.AppointmentRepository;
import com.clinicmanagement.repository.MedicalRecordRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.Clock;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MedicalRecordService {
    private final MedicalRecordRepository records;
    private final AppointmentRepository appointments;
    private final UserRepository users;
    private final Clock clock;
    private final PatientRepository patients;

    public MedicalRecordService(MedicalRecordRepository records, AppointmentRepository appointments,
                                UserRepository users, Clock clock, PatientRepository patients) {
        this.records = records;
        this.appointments = appointments;
        this.users = users;
        this.clock = clock;
        this.patients = patients;
    }

    @Transactional
    @PreAuthorize("hasRole('DOCTOR')")
    public MedicalRecordView.Clinical create(AuthenticatedUser viewer, Long appointmentId) {
        Appointment appointment = lockAppointment(appointmentId);
        requireAssigned(viewer, appointment);
        requireStatus(appointment, AppointmentStatus.CHECKED_IN);
        appointment.startExamination();
        // Flush the state transition inside the transaction before inserting the draft.
        try {
            appointments.flush();
            var record = new MedicalRecord(appointment, users.getReferenceById(viewer.id()), clock.instant());
            return MedicalRecordView.Clinical.from(records.saveAndFlush(record));
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("MEDICAL_RECORD_CONFLICT", "Medical record could not be created.");
        } catch (ObjectOptimisticLockingFailureException exception) {
            throw versionConflict();
        }
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('DOCTOR','PATIENT','ADMIN','RECEPTIONIST')")
    public MedicalRecordView get(AuthenticatedUser viewer, Long id) {
        MedicalRecord record = records.findById(id).orElseThrow(ManagementException::missing);
        return view(viewer, record);
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('DOCTOR','PATIENT','ADMIN','RECEPTIONIST')")
    public MedicalRecordView getByAppointment(AuthenticatedUser viewer, Long appointmentId) {
        MedicalRecord record = records.findByAppointmentId(appointmentId).orElseThrow(ManagementException::missing);
        return view(viewer, record);
    }

    private MedicalRecordView view(AuthenticatedUser viewer, MedicalRecord record) {
        var appointment = record.getAppointment();
        return switch (viewer.role()) {
            case ADMIN, RECEPTIONIST -> MedicalRecordView.Metadata.from(record);
            case DOCTOR -> {
                requireAssigned(viewer, appointment);
                yield MedicalRecordView.Clinical.from(record);
            }
            case PATIENT -> {
                User owner = appointment.getPatient().getUser();
                if (appointment.getStatus() != AppointmentStatus.COMPLETED || record.getCompletedAt() == null
                        || record.getReleasedAt() == null || record.getReleasedBy() == null
                        || owner == null || !viewer.id().equals(owner.getId())) {
                    throw ManagementException.missing();
                }
                yield MedicalRecordView.Clinical.from(record);
            }
        };
    }

    @Transactional
    @PreAuthorize("hasRole('DOCTOR')")
    public MedicalRecordView.Clinical patch(AuthenticatedUser viewer, Long id, MedicalRecordPatchRequest request) {
        MedicalRecord record = lockDraft(viewer, id, request.expectedVersion());
        if (!request.hasChanges()) {
            throw validation("Supply at least one clinical field.");
        }
        record.update(request.symptoms(), request.diagnosis(), request.notes(), request.conclusion(), clock.instant());
        return flush(record);
    }

    @Transactional
    @PreAuthorize("hasRole('DOCTOR')")
    public MedicalRecordView.Clinical complete(AuthenticatedUser viewer, Long id, Long expectedVersion) {
        MedicalRecord record = lockDraft(viewer, id, expectedVersion);
        if (!record.hasRequiredContent()) {
            throw validation("Symptoms, diagnosis and conclusion are required.");
        }
        record.getAppointment().completeExamination();
        try {
            appointments.flush();
        } catch (ObjectOptimisticLockingFailureException exception) {
            throw versionConflict();
        }
        record.complete(users.getReferenceById(viewer.id()), clock.instant());
        return flush(record);
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('DOCTOR','PATIENT','ADMIN','RECEPTIONIST')")
    public PageResponse<MedicalHistoryItem> history(AuthenticatedUser viewer, Long patientId, int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw validation("Invalid pagination.");
        }
        var patient = patients.findById(patientId).orElseThrow(ManagementException::missing);
        if (viewer.role() == Role.PATIENT && (patient.getUser() == null
                || !viewer.id().equals(patient.getUser().getId()))) {
            throw ManagementException.missing();
        }
        if (viewer.role() == Role.DOCTOR && !appointments.hasHistoryAssignment(patientId, viewer.id())) {
            throw ManagementException.missing();
        }
        return PageResponse.from(records.history(patientId, viewer.role() == Role.DOCTOR ? viewer.id() : null,
                viewer.role() == Role.PATIENT, PageRequest.of(page, size)).map(row ->
                new MedicalHistoryItem(row.getId().toString(), row.getAppointmentId().toString(),
                        row.getDoctorId().toString(), row.getCompletedAt(), row.getReleasedAt(), row.getVersion())));
    }

    @Transactional
    @PreAuthorize("hasRole('DOCTOR')")
    public MedicalRecordView.Clinical release(AuthenticatedUser viewer, Long id, Long expectedVersion) {
        Long appointmentId = records.findAppointmentId(id).orElseThrow(ManagementException::missing);
        Appointment appointment = lockAppointment(appointmentId);
        requireAssigned(viewer, appointment);
        requireStatus(appointment, AppointmentStatus.COMPLETED);
        MedicalRecord record = records.findLocked(id).orElseThrow(ManagementException::missing);
        if (!record.getVersion().equals(expectedVersion)) {
            throw versionConflict();
        }
        if (record.getCompletedAt() == null || record.getCompletedBy() == null) {
            throw ManagementException.conflict("INVALID_STATE_TRANSITION", "Medical record is not completed.");
        }
        if (record.getReleasedAt() != null) {
            return MedicalRecordView.Clinical.from(record);
        }
        record.release(users.getReferenceById(viewer.id()), clock.instant());
        return flush(record);
    }

    private MedicalRecord lockDraft(AuthenticatedUser viewer, Long id, Long expectedVersion) {
        // Resolve only the immutable FK before locking. All writes lock appointment before record.
        Long appointmentId = records.findAppointmentId(id).orElseThrow(ManagementException::missing);
        Appointment appointment = lockAppointment(appointmentId);
        requireAssigned(viewer, appointment);
        requireStatus(appointment, AppointmentStatus.IN_PROGRESS);
        MedicalRecord record = records.findLocked(id).orElseThrow(ManagementException::missing);
        if (record.getCompletedAt() != null) {
            throw ManagementException.conflict("INVALID_STATE_TRANSITION", "Medical record is already completed.");
        }
        if (!record.getVersion().equals(expectedVersion)) {
            throw versionConflict();
        }
        return record;
    }

    private Appointment lockAppointment(Long id) {
        return appointments.findLockedForExamination(id).orElseThrow(ManagementException::missing);
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

    private MedicalRecordView.Clinical flush(MedicalRecord record) {
        try {
            records.flush();
            return MedicalRecordView.Clinical.from(record);
        } catch (ObjectOptimisticLockingFailureException exception) {
            throw versionConflict();
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("MEDICAL_RECORD_CONFLICT", "Medical record could not be saved.");
        }
    }

    private static ManagementException versionConflict() {
        return ManagementException.conflict("VERSION_CONFLICT", "Medical record or appointment has changed.");
    }

    private static ManagementException validation(String message) {
        return new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }
}
