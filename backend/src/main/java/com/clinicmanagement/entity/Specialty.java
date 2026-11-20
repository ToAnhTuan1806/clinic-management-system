package com.clinicmanagement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "specialties", uniqueConstraints = {
        @UniqueConstraint(name = "uk_specialties_code", columnNames = "code"),
        @UniqueConstraint(name = "uk_specialties_name", columnNames = "name")})
public class Specialty {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, length = 32)
    private String code;
    @Column(nullable = false, length = 120)
    private String name;
    @Column(columnDefinition = "text")
    private String description;
    @Column(name = "is_active", nullable = false)
    private boolean active;
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Specialty() { }

    public Specialty(String code, String name, String description, boolean active) {
        update(code, name, description, active);
    }

    public void update(String code, String name, String description, boolean active) {
        this.code = code;
        this.name = name;
        this.description = description;
        this.active = active;
    }

    @PrePersist void created() { createdAt = Instant.now(); updatedAt = createdAt; }
    @PreUpdate void updated() { updatedAt = Instant.now(); }
    public Long getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public boolean isActive() { return active; }
}
