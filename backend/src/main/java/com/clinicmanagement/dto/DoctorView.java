package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Doctor;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.UserStatus;

public sealed interface DoctorView {
    record Public(String id, String doctorCode, String fullName, String specialtyId, String specialtyName,
                  String biography, boolean isActive) implements DoctorView { }
    record Coordination(String id, String doctorCode, String fullName, String specialtyId, String specialtyName,
                        String biography, boolean isActive, UserStatus userStatus) implements DoctorView { }
    record Internal(String id, String doctorCode, String fullName, String specialtyId, String specialtyName,
                    String biography, boolean isActive, String userId, UserStatus userStatus,
                    String licenseNumber) implements DoctorView { }

    static DoctorView from(Doctor doctor, Role role) {
        String id = doctor.getId().toString();
        String specialty = doctor.getSpecialty().getId().toString();
        String name = doctor.getUser().getFullName();
        if (role == Role.PATIENT) {
            return new Public(id, doctor.getDoctorCode(), name, specialty, doctor.getSpecialty().getName(),
                    doctor.getBiography(), doctor.isActive());
        }
        if (role == Role.RECEPTIONIST) {
            return new Coordination(id, doctor.getDoctorCode(), name, specialty, doctor.getSpecialty().getName(),
                    doctor.getBiography(), doctor.isActive(), doctor.getUser().getStatus());
        }
        return new Internal(id, doctor.getDoctorCode(), name, specialty, doctor.getSpecialty().getName(),
                doctor.getBiography(), doctor.isActive(), doctor.getUser().getId().toString(),
                doctor.getUser().getStatus(), doctor.getLicenseNumber());
    }
}
