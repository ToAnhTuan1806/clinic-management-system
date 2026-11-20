package com.clinicmanagement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "doctors", uniqueConstraints = {
        @UniqueConstraint(name = "uk_doctors_user", columnNames = "user_id"),
        @UniqueConstraint(name = "uk_doctors_code", columnNames = "doctor_code"),
        @UniqueConstraint(name = "uk_doctors_license", columnNames = "license_number")})
public class Doctor {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, unique = true, updatable = false)
    private User user;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "specialty_id", nullable = false)
    private Specialty specialty;
    @Column(name = "doctor_code", nullable = false, length = 32)
    private String doctorCode;
    @Column(name = "license_number", length = 100)
    private String licenseNumber;
    @Column(columnDefinition = "text")
    private String biography;
    @Column(name = "is_active", nullable = false)
    private boolean active;
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Doctor() { }

    public Doctor(User user, Specialty specialty, String code, String license, String biography, boolean active) {
        this.user = user;
        update(specialty, code, license, biography, active);
    }

    public void update(Specialty specialty, String code, String license, String biography, boolean active) {
        this.specialty = specialty;
        this.doctorCode = code;
        this.licenseNumber = license;
        this.biography = biography;
        this.active = active;
    }

    @PrePersist void created() { createdAt = Instant.now(); updatedAt = createdAt; }
    @PreUpdate void updated() { updatedAt = Instant.now(); }
    public Long getId() { return id; }
    public User getUser() { return user; }
    public Specialty getSpecialty() { return specialty; }
    public String getDoctorCode() { return doctorCode; }
    public String getLicenseNumber() { return licenseNumber; }
    public String getBiography() { return biography; }
    public boolean isActive() { return active; }
}
