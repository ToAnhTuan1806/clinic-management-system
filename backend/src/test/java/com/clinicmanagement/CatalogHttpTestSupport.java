package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.clinicmanagement.entity.*;
import com.clinicmanagement.repository.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(OutputCaptureExtension.class)
abstract class CatalogHttpTestSupport extends TestSecurityProperties {
    @LocalServerPort private int port;
    @Autowired private ObjectMapper mapper;
    @Autowired private DoctorRepository doctors;
    @Autowired private SpecialtyRepository specialties;
    @Autowired private UserRepository users;
    @Autowired private PasswordEncoder passwords;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private DataSource dataSource;
    private final List<String> secrets = new ArrayList<>();
    private final Map<Role, User> actors = new EnumMap<>(Role.class);
    private final Map<Role, String> tokens = new EnumMap<>(Role.class);
    private String password;
    private String hash;
    private User secondDoctor;

    @BeforeEach
    void prepare() throws Exception {
        try (var connection = dataSource.getConnection()) {
            if (!"H2".equals(connection.getMetaData().getDatabaseProductName())) {
                MySqlTestDatabase.requireIsolatedUrl(connection.getMetaData().getURL());
            }
        }
        doctors.deleteAll();
        specialties.deleteAll();
        users.deleteAll();
        actors.clear(); tokens.clear(); secrets.clear();
        password = UUID.randomUUID().toString();
        hash = passwords.encode(password);
        secrets.add(password); secrets.add(hash);
        for (Role role : Role.values()) {
            actors.put(role, seed(role, role == Role.DOCTOR ? "Doctor Alpha" : "Synthetic " + role));
        }
        secondDoctor = seed(Role.DOCTOR, "Doctor Beta");
    }

    @AfterEach
    void noCredentialOutput(CapturedOutput output) {
        for (String secret : secrets) {
            assertThat(output.getAll().contains(secret)).as("credential must not be logged").isFalse();
        }
    }

    private User seed(Role role, String name) {
        User user = users.saveAndFlush(User.registerPatient(UUID.randomUUID() + "@example.invalid", hash, name));
        jdbc.update("UPDATE users SET role = ? WHERE id = ?", role.name(), user.getId());
        return user;
    }

    @Test
    void specialtyCreatePatchSearchAndPagination() throws Exception {
        var first = call("POST", "/api/v1/specialties", Map.of("code", " ent ", "name", " Ear Clinic ",
                "description", " Test description "), Role.ADMIN);
        assertThat(first.statusCode()).isEqualTo(201);
        JsonNode value = body(first).path("data");
        String id = value.path("id").asString();
        assertThat(id).matches("[1-9][0-9]*");
        assertThat(value.path("code").asString()).isEqualTo("ENT");
        assertThat(value.path("name").asString()).isEqualTo("Ear Clinic");
        assertThat(first.headers().firstValue("Location")).contains("/api/v1/specialties/" + id);
        specialty("CARD", "Cardiology", true);
        specialty("OLD", "Old Department", false);
        assertThat(list("/api/v1/specialties?q=ear&isActive=true&page=0&size=1", Role.ADMIN).path("totalElements").asLong()).isEqualTo(1);
        JsonNode page = list("/api/v1/specialties?page=1&size=1", Role.ADMIN);
        assertThat(page.path("items").size()).isEqualTo(1);
        assertThat(page.path("totalPages").asInt()).isEqualTo(3);
        assertThat(page.path("items").get(0).path("code").asString()).isEqualTo("ENT");
        var patch = call("PATCH", "/api/v1/specialties/" + id, Map.of("description", "", "isActive", false), Role.ADMIN);
        assertThat(patch.statusCode()).isEqualTo(200);
        assertThat(body(patch).path("data").path("description").isNull()).isTrue();
        assertThat(body(patch).path("data").path("isActive").asBoolean()).isFalse();
        assertThat(call("PATCH", "/api/v1/specialties/" + id, Map.of("isActive", true), Role.ADMIN).statusCode()).isEqualTo(200);
        problem(call("DELETE", "/api/v1/specialties/" + id, null, Role.ADMIN), 403, "ACCESS_DENIED");
        assertThat(specialties.count()).isEqualTo(3);
    }

    @Test
    void specialtyCodeAndNameAreUniqueOnCreateAndPatch() throws Exception {
        String first = specialty("ENT", "Ear Clinic", true);
        String second = specialty("CARD", "Cardiology", true);
        problem(call("POST", "/api/v1/specialties", Map.of("code", "ent", "name", "Other"), Role.ADMIN), 409, "SPECIALTY_CODE_EXISTS");
        problem(call("POST", "/api/v1/specialties", Map.of("code", "NEW", "name", " ear clinic "), Role.ADMIN), 409, "SPECIALTY_NAME_EXISTS");
        problem(call("PATCH", "/api/v1/specialties/" + second, Map.of("code", "ENT"), Role.ADMIN), 409, "SPECIALTY_CODE_EXISTS");
        problem(call("PATCH", "/api/v1/specialties/" + second, Map.of("name", "EAR CLINIC"), Role.ADMIN), 409, "SPECIALTY_NAME_EXISTS");
        assertThat(call("PATCH", "/api/v1/specialties/" + first, Map.of("name", "Ear Clinic"), Role.ADMIN).statusCode()).isEqualTo(200);
    }

    @Test
    void doctorCreatePatchSearchAndNullableLicense() throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        String otherSpecialty = specialty("CARD", "Cardiology", true);
        Map<String, Object> payload = doctorPayload(actors.get(Role.DOCTOR).getId(), specialty, " dr_a ");
        payload.put("licenseNumber", " lic-001 ");
        payload.put("biography", " Example biography ");
        var response = call("POST", "/api/v1/doctors", payload, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(201);
        JsonNode doctor = body(response).path("data");
        String id = doctor.path("id").asString();
        assertThat(doctor.path("doctorCode").asString()).isEqualTo("DR_A");
        assertThat(doctor.path("fullName").asString()).isEqualTo("Doctor Alpha");
        assertThat(doctor.path("licenseNumber").asString()).isEqualTo("LIC-001");
        assertThat(response.headers().firstValue("Location")).contains("/api/v1/doctors/" + id);
        createDoctor(secondDoctor.getId(), specialty, "DR_B", true);
        var patch = call("PATCH", "/api/v1/doctors/" + id,
                Map.of("licenseNumber", "", "biography", "", "specialtyId", otherSpecialty), Role.ADMIN);
        assertThat(patch.statusCode()).isEqualTo(200);
        assertThat(body(patch).path("data").path("licenseNumber").isNull()).isTrue();
        assertThat(body(patch).path("data").path("biography").isNull()).isTrue();
        assertThat(list("/api/v1/doctors?q=alpha&specialtyId=" + otherSpecialty, Role.ADMIN).path("totalElements").asLong()).isEqualTo(1);
        assertThat(list("/api/v1/doctors?q=DR_B", Role.ADMIN).path("totalElements").asLong()).isEqualTo(1);
        assertThat(list("/api/v1/doctors?page=1&size=1", Role.ADMIN).path("items").get(0).path("doctorCode").asString()).isEqualTo("DR_B");
        problem(call("PATCH", "/api/v1/doctors/" + id, Map.of("userId", secondDoctor.getId()), Role.ADMIN), 400, "HTTP_400");
        problem(call("DELETE", "/api/v1/doctors/" + id, null, Role.ADMIN), 403, "ACCESS_DENIED");
        assertThat(doctors.count()).isEqualTo(2);
    }

    @Test
    void doctorCodeLicenseAndUserLinkCannotBeDuplicated() throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        Map<String, Object> first = doctorPayload(actors.get(Role.DOCTOR).getId(), specialty, "DR_A");
        first.put("licenseNumber", "LIC-001");
        assertThat(call("POST", "/api/v1/doctors", first, Role.ADMIN).statusCode()).isEqualTo(201);
        problem(call("POST", "/api/v1/doctors", doctorPayload(actors.get(Role.DOCTOR).getId(), specialty, "OTHER"), Role.ADMIN), 409, "USER_ALREADY_LINKED");
        Map<String, Object> duplicate = doctorPayload(secondDoctor.getId(), specialty, "DR_A");
        problem(call("POST", "/api/v1/doctors", duplicate, Role.ADMIN), 409, "DOCTOR_CODE_EXISTS");
        duplicate.put("doctorCode", "DR_B"); duplicate.put("licenseNumber", " lic-001 ");
        problem(call("POST", "/api/v1/doctors", duplicate, Role.ADMIN), 409, "LICENSE_NUMBER_EXISTS");
        duplicate.remove("licenseNumber");
        var created = call("POST", "/api/v1/doctors", duplicate, Role.ADMIN);
        assertThat(created.statusCode()).isEqualTo(201);
        String id = body(created).path("data").path("id").asString();
        problem(call("PATCH", "/api/v1/doctors/" + id, Map.of("doctorCode", "DR_A"), Role.ADMIN), 409, "DOCTOR_CODE_EXISTS");
        problem(call("PATCH", "/api/v1/doctors/" + id, Map.of("licenseNumber", "LIC-001"), Role.ADMIN), 409, "LICENSE_NUMBER_EXISTS");
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void onlyAdminCanWriteAndEachRoleSeesItsAllowedFields(Role role) throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        specialty("OLD", "Old Department", false);
        String first = createDoctor(actors.get(Role.DOCTOR).getId(), specialty, "DR_A", true);
        String second = createDoctor(secondDoctor.getId(), specialty, "DR_B", false);
        JsonNode page = list("/api/v1/doctors", role);
        assertThat(page.path("totalElements").asLong()).isEqualTo(role == Role.DOCTOR || role == Role.PATIENT ? 1 : 2);
        JsonNode value = page.path("items").get(0);
        assertThat(value.path("id").asString()).isEqualTo(first);
        if (role == Role.PATIENT || role == Role.RECEPTIONIST) {
            assertThat(value.has("userId")).isFalse();
            assertThat(value.has("licenseNumber")).isFalse();
        } else {
            assertThat(value.path("userId").asString()).isEqualTo(actors.get(Role.DOCTOR).getId().toString());
        }
        assertThat(value.has("passwordHash")).isFalse(); assertThat(value.has("email")).isFalse();
        if (role == Role.PATIENT) assertThat(value.has("userStatus")).isFalse();
        if (role == Role.DOCTOR || role == Role.PATIENT) {
            problem(call("GET", "/api/v1/doctors/" + second, null, role), 404, "RESOURCE_NOT_FOUND");
        }
        assertThat(list("/api/v1/specialties", role).path("totalElements").asLong())
                .isEqualTo(role == Role.DOCTOR || role == Role.PATIENT ? 1 : 2);
        var write = call("POST", "/api/v1/specialties", Map.of("code", "NEW", "name", "New"), role);
        if (role == Role.ADMIN) {
            assertThat(write.statusCode()).isEqualTo(201);
            assertThat(call("PATCH", "/api/v1/doctors/" + first, Map.of("biography", "Updated"), role).statusCode()).isEqualTo(200);
        } else {
            problem(write, 403, "ACCESS_DENIED");
            problem(call("POST", "/api/v1/doctors", doctorPayload(secondDoctor.getId(), specialty, "NEW"), role), 403, "ACCESS_DENIED");
            problem(call("PATCH", "/api/v1/specialties/" + specialty, Map.of("name", "Updated"), role), 403, "ACCESS_DENIED");
            problem(call("PATCH", "/api/v1/doctors/" + first, Map.of("biography", "Updated"), role), 403, "ACCESS_DENIED");
        }
    }

    @Test
    void inactiveSpecialtyAndDoctorPoliciesAreEnforced() throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        String inactive = specialty("OLD", "Old Department", false);
        String doctor = createDoctor(actors.get(Role.DOCTOR).getId(), specialty, "DR_A", true);
        problem(call("PATCH", "/api/v1/specialties/" + specialty, Map.of("isActive", false), Role.ADMIN), 409, "SPECIALTY_HAS_ACTIVE_DOCTORS");
        problem(call("POST", "/api/v1/doctors", doctorPayload(secondDoctor.getId(), inactive, "DR_B"), Role.ADMIN), 409, "SPECIALTY_INACTIVE");
        problem(call("PATCH", "/api/v1/doctors/" + doctor, Map.of("specialtyId", inactive), Role.ADMIN), 409, "SPECIALTY_INACTIVE");
        assertThat(call("PATCH", "/api/v1/doctors/" + doctor, Map.of("isActive", false), Role.ADMIN).statusCode()).isEqualTo(200);
        assertThat(call("PATCH", "/api/v1/specialties/" + specialty, Map.of("isActive", false), Role.ADMIN).statusCode()).isEqualTo(200);
        problem(call("PATCH", "/api/v1/doctors/" + doctor, Map.of("isActive", true), Role.ADMIN), 409, "SPECIALTY_INACTIVE");
        assertThat(list("/api/v1/doctors", Role.PATIENT).path("totalElements").asLong()).isZero();
        problem(call("GET", "/api/v1/specialties/" + inactive, null, Role.PATIENT), 404, "RESOURCE_NOT_FOUND");
        problem(call("GET", "/api/v1/doctors?isActive=false", null, Role.PATIENT), 403, "ACCESS_DENIED");
        problem(call("GET", "/api/v1/specialties?isActive=false", null, Role.DOCTOR), 403, "ACCESS_DENIED");
        assertThat(call("GET", "/api/v1/doctors/" + doctor, null, Role.DOCTOR).statusCode()).isEqualTo(200);
    }

    @Test
    void patientVisibilityUsesCurrentSpecialtyAndUserState() throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        String first = createDoctor(actors.get(Role.DOCTOR).getId(), specialty, "DR_A", true);
        String second = createDoctor(secondDoctor.getId(), specialty, "DR_B", true);
        assertThat(list("/api/v1/doctors", Role.PATIENT).path("totalElements").asLong()).isEqualTo(2);
        jdbc.update("UPDATE specialties SET is_active = FALSE WHERE id = ?", Long.valueOf(specialty));
        assertThat(list("/api/v1/doctors", Role.PATIENT).path("totalElements").asLong()).isZero();
        problem(call("GET", "/api/v1/doctors/" + first, null, Role.PATIENT), 404, "RESOURCE_NOT_FOUND");
        assertThat(list("/api/v1/doctors", Role.RECEPTIONIST).path("totalElements").asLong()).isEqualTo(2);
        jdbc.update("UPDATE specialties SET is_active = TRUE WHERE id = ?", Long.valueOf(specialty));
        jdbc.update("UPDATE users SET role = 'PATIENT' WHERE id = ?", secondDoctor.getId());
        assertThat(list("/api/v1/doctors", Role.PATIENT).path("totalElements").asLong()).isEqualTo(1);
        problem(call("GET", "/api/v1/doctors/" + second, null, Role.PATIENT), 404, "RESOURCE_NOT_FOUND");
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", actors.get(Role.DOCTOR).getId());
        assertThat(list("/api/v1/doctors", Role.PATIENT).path("totalElements").asLong()).isZero();
    }

    @Test
    void invalidUsersAndMissingForeignKeysAreRejected() throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        for (Role invalid : List.of(Role.PATIENT, Role.RECEPTIONIST, Role.ADMIN)) {
            problem(call("POST", "/api/v1/doctors", doctorPayload(actors.get(invalid).getId(), specialty, "BAD"), Role.ADMIN), 409, "USER_NOT_ELIGIBLE");
        }
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", secondDoctor.getId());
        problem(call("POST", "/api/v1/doctors", doctorPayload(secondDoctor.getId(), specialty, "BAD"), Role.ADMIN), 409, "USER_NOT_ELIGIBLE");
        problem(call("POST", "/api/v1/doctors", doctorPayload(Long.MAX_VALUE, specialty, "BAD"), Role.ADMIN), 404, "RESOURCE_NOT_FOUND");
        problem(call("POST", "/api/v1/doctors", doctorPayload(actors.get(Role.DOCTOR).getId(), Long.MAX_VALUE + "", "BAD"), Role.ADMIN), 404, "RESOURCE_NOT_FOUND");
        String doctor = createDoctor(actors.get(Role.DOCTOR).getId(), specialty, "DR_A", true);
        problem(call("PATCH", "/api/v1/doctors/" + doctor, Map.of("specialtyId", Long.MAX_VALUE + ""), Role.ADMIN), 404, "RESOURCE_NOT_FOUND");
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("UPDATE doctors SET specialty_id = ? WHERE id = ?", Long.MAX_VALUE, Long.parseLong(doctor)));
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", actors.get(Role.DOCTOR).getId());
        assertThat(list("/api/v1/doctors", Role.PATIENT).path("totalElements").asLong()).isZero();
        problem(call("PATCH", "/api/v1/doctors/" + doctor, Map.of("isActive", true), Role.ADMIN), 409, "USER_NOT_ELIGIBLE");
        assertThat(call("PATCH", "/api/v1/doctors/" + doctor, Map.of("isActive", false), Role.ADMIN).statusCode()).isEqualTo(200);
    }

    @ParameterizedTest(name = "specialty validation: {0}")
    @ValueSource(strings = {"code", "name", "description", "id"})
    void specialtyValidation(String field) throws Exception {
        Map<String, Object> payload = new HashMap<>(Map.of("code", "VALID", "name", "Valid"));
        payload.put(field, switch (field) { case "code" -> "bad code"; case "name" -> " "; case "description" -> "x".repeat(5001); default -> "1"; });
        assertThat(call("POST", "/api/v1/specialties", payload, Role.ADMIN).statusCode()).isEqualTo(400);
        assertThat(specialties.count()).isZero();
    }

    @ParameterizedTest(name = "doctor validation: {0}")
    @ValueSource(strings = {"userId", "specialtyId", "doctorCode", "licenseNumber", "biography", "role"})
    void doctorValidation(String field) throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        Map<String, Object> payload = doctorPayload(actors.get(Role.DOCTOR).getId(), specialty, "VALID");
        payload.put(field, switch (field) { case "userId", "specialtyId" -> "0"; case "doctorCode" -> " ";
            case "licenseNumber" -> "x".repeat(101); case "biography" -> "x".repeat(5001); default -> "ADMIN"; });
        assertThat(call("POST", "/api/v1/doctors", payload, Role.ADMIN).statusCode()).isEqualTo(400);
        assertThat(doctors.count()).isZero();
    }

    @ParameterizedTest(name = "pagination validation: {0}")
    @ValueSource(strings = {"page=-1", "size=0", "size=101", "specialtyId=0", "isActive=invalid"})
    void paginationValidation(String query) throws Exception {
        assertThat(call("GET", "/api/v1/doctors?" + query, null, Role.ADMIN).statusCode()).isEqualTo(400);
    }

    @Test
    void missingResourcesEmptyPatchesAndLiteralSearch() throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        problem(call("GET", "/api/v1/specialties/" + Long.MAX_VALUE, null, Role.ADMIN), 404, "RESOURCE_NOT_FOUND");
        problem(call("GET", "/api/v1/doctors/" + Long.MAX_VALUE, null, Role.ADMIN), 404, "RESOURCE_NOT_FOUND");
        problem(call("PATCH", "/api/v1/specialties/" + specialty, Map.of(), Role.ADMIN), 400, "VALIDATION_FAILED");
        String doctor = createDoctor(actors.get(Role.DOCTOR).getId(), specialty, "DRA", true);
        problem(call("PATCH", "/api/v1/doctors/" + doctor, Map.of(), Role.ADMIN), 400, "VALIDATION_FAILED");
        assertThat(call("GET", "/api/v1/specialties/0", null, Role.ADMIN).statusCode()).isEqualTo(400);
        assertThat(call("GET", "/api/v1/doctors/0", null, Role.ADMIN).statusCode()).isEqualTo(400);
        assertThat(call("GET", "/api/v1/doctors?q=" + "x".repeat(121), null, Role.ADMIN).statusCode()).isEqualTo(400);
        for (String query : List.of("%", "_", "' OR 1=1 --")) {
            assertThat(list("/api/v1/doctors?q=" + URLEncoder.encode(query, StandardCharsets.UTF_8), Role.ADMIN).path("totalElements").asLong()).isZero();
        }
    }

    @Test
    void anonymousRequestsAndUnknownEndpointsStayProtected() throws Exception {
        for (String resource : List.of("doctors", "specialties")) {
            for (String method : List.of("GET", "POST", "PATCH")) {
                String path = "/api/v1/" + resource + (method.equals("PATCH") ? "/1" : "");
                problem(call(method, path, method.equals("GET") ? null : Map.of(), null), 401, "AUTHENTICATION_REQUIRED");
            }
        }
        problem(call("GET", "/api/v1/doctors/1/available-slots", null, Role.ADMIN), 403, "ACCESS_DENIED");
        problem(call("POST", "/api/v1/auth/register", Map.of("email", UUID.randomUUID() + "@example.invalid",
                "password", password, "fullName", "Synthetic", "role", "DOCTOR"), null), 400, "HTTP_400");
    }

    @Test
    void corsAllowsPatchOnlyForConfiguredOrigin() throws Exception {
        var allowed = request("OPTIONS", "/api/v1/doctors/1", null, null, Map.of("Origin", TEST_ORIGIN,
                "Access-Control-Request-Method", "PATCH", "Access-Control-Request-Headers", "authorization,content-type"));
        assertThat(allowed.statusCode()).isEqualTo(200);
        assertThat(allowed.headers().firstValue("Access-Control-Allow-Methods").orElse("")).contains("PATCH");
        assertThat(allowed.headers().firstValue("Access-Control-Allow-Origin")).contains(TEST_ORIGIN);
        assertThat(allowed.headers().firstValue("Access-Control-Allow-Credentials")).isEmpty();
        problem(request("OPTIONS", "/api/v1/doctors/1", null, null, Map.of("Origin", "https://untrusted.example.invalid",
                "Access-Control-Request-Method", "PATCH")), 403, "CORS_REJECTED");
    }

    @Test
    void creatingDoctorAndDisablingSpecialtyCannotBothSucceed() throws Exception {
        String specialty = specialty("ENT", "Ear Clinic", true);
        token(Role.ADMIN);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var create = executor.submit(() -> { start.await(); return call("POST", "/api/v1/doctors", doctorPayload(actors.get(Role.DOCTOR).getId(), specialty, "DR_A"), Role.ADMIN); });
            var disable = executor.submit(() -> { start.await(); return call("PATCH", "/api/v1/specialties/" + specialty, Map.of("isActive", false), Role.ADMIN); });
            start.countDown();
            int created = create.get().statusCode();
            int disabled = disable.get().statusCode();
            assertThat((created == 201 && disabled == 409) || (created == 409 && disabled == 200)).isTrue();
        }
        Specialty current = specialties.findById(Long.valueOf(specialty)).orElseThrow();
        assertThat(!current.isActive() && doctors.existsBySpecialtyIdAndActiveTrue(current.getId())).isFalse();
    }

    @Test
    void concurrentCreatesCannotLinkOneUserTwice() throws Exception {
        String firstSpecialty = specialty("ENT", "Ear Clinic", true);
        String secondSpecialty = specialty("CARD", "Cardiology", true);
        token(Role.ADMIN);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> { start.await(); return call("POST", "/api/v1/doctors",
                    doctorPayload(actors.get(Role.DOCTOR).getId(), firstSpecialty, "DR_A"), Role.ADMIN); });
            var second = executor.submit(() -> { start.await(); return call("POST", "/api/v1/doctors",
                    doctorPayload(actors.get(Role.DOCTOR).getId(), secondSpecialty, "DR_B"), Role.ADMIN); });
            start.countDown();
            assertThat(List.of(first.get().statusCode(), second.get().statusCode())).containsExactlyInAnyOrder(201, 409);
        }
        assertThat(doctors.count()).isEqualTo(1);
    }

    private String specialty(String code, String name, boolean active) throws Exception {
        var response = call("POST", "/api/v1/specialties", Map.of("code", code, "name", name, "isActive", active), Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(201);
        return body(response).path("data").path("id").asString();
    }

    private String createDoctor(Long user, String specialty, String code, boolean active) throws Exception {
        Map<String, Object> payload = doctorPayload(user, specialty, code);
        payload.put("isActive", active);
        var response = call("POST", "/api/v1/doctors", payload, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(201);
        return body(response).path("data").path("id").asString();
    }

    private Map<String, Object> doctorPayload(Long user, String specialty, String code) {
        return new HashMap<>(Map.of("userId", user.toString(), "specialtyId", specialty, "doctorCode", code));
    }

    private JsonNode list(String path, Role role) throws Exception {
        var response = call("GET", path, null, role);
        assertThat(response.statusCode()).isEqualTo(200);
        return body(response).path("data");
    }

    private JsonNode body(HttpResponse<String> response) { return mapper.readTree(response.body()); }

    private void problem(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/problem+json");
        assertThat(body(response).path("status").asInt()).isEqualTo(status);
        assertThat(body(response).path("code").asString()).isEqualTo(code);
        assertThat(response.body().contains(hash)).isFalse();
        assertThat(response.body().contains(password)).isFalse();
    }

    private String token(Role role) throws Exception {
        if (!tokens.containsKey(role)) {
            var response = request("POST", "/api/v1/auth/login", Map.of("email", actors.get(role).getEmail(), "password", password), null, Map.of());
            assertThat(response.statusCode()).isEqualTo(200);
            String token = body(response).path("data").path("accessToken").asString();
            tokens.put(role, token); secrets.add(token);
        }
        return tokens.get(role);
    }

    private HttpResponse<String> call(String method, String path, Object payload, Role role) throws Exception {
        return request(method, path, payload, role == null ? null : token(role), Map.of());
    }

    private HttpResponse<String> request(String method, String path, Object payload, String token,
                                          Map<String, String> headers) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        if (payload != null) builder.header("Content-Type", "application/json");
        if (token != null) builder.header("Authorization", "Bearer " + token);
        headers.forEach(builder::header);
        builder.method(method, payload == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)));
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }
    }
}
