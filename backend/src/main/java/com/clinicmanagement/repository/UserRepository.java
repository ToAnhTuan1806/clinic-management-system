package com.clinicmanagement.repository;

import com.clinicmanagement.entity.User;
import java.util.Optional;
import java.time.Instant;
import com.clinicmanagement.entity.UserStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);

    @Modifying(clearAutomatically = true)
    @Query("update User u set u.lastLoginAt = :now, u.updatedAt = :now where u.id = :id and u.status = :status")
    int recordLoginIfActive(@Param("id") Long id, @Param("now") Instant now, @Param("status") UserStatus status);
}
