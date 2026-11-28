package com.clinicmanagement.repository;

import com.clinicmanagement.entity.User;
import com.clinicmanagement.dto.EligibleDoctorUserResponse;
import java.util.Optional;
import java.time.Instant;
import com.clinicmanagement.entity.UserStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface UserRepository extends JpaRepository<User, Long> {
    @Query("select u from User u where u.id in :ids and u.status = com.clinicmanagement.entity.UserStatus.ACTIVE")
    java.util.List<User> findActiveNotificationRecipients(@Param("ids") java.util.Set<Long> ids);
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);

    @Query("""
            select new com.clinicmanagement.dto.EligibleDoctorUserResponse(u.id, u.fullName, u.email)
            from User u
            where u.role = com.clinicmanagement.entity.Role.DOCTOR
              and u.status = com.clinicmanagement.entity.UserStatus.ACTIVE
              and not exists (select d.id from Doctor d where d.user.id = u.id)
              and (:search = '' or locate(:search, lower(u.fullName)) > 0
                   or locate(:search, lower(u.email)) > 0)
            """)
    Page<EligibleDoctorUserResponse> findEligibleDoctors(@Param("search") String search, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from User u where u.id = :id")
    Optional<User> findLocked(@Param("id") Long id);

    @Modifying(clearAutomatically = true)
    @Query("update User u set u.lastLoginAt = :now, u.updatedAt = :now where u.id = :id and u.status = :status")
    int recordLoginIfActive(@Param("id") Long id, @Param("now") Instant now, @Param("status") UserStatus status);
}
