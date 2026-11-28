package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.clinicmanagement.entity.*;
import com.clinicmanagement.repository.*;
import java.net.URI;
import java.net.http.*;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(OutputCaptureExtension.class)
abstract class PatientAndProfileHttpTestSupport extends TestSecurityProperties {
    @LocalServerPort private int port;
    @Autowired private ObjectMapper mapper;
    @Autowired private PatientRepository patients;
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

    @BeforeEach
    void prepare() throws Exception {
        try (var connection = dataSource.getConnection()) {
            if (!"H2".equals(connection.getMetaData().getDatabaseProductName())) {
                MySqlTestDatabase.requireIsolatedUrl(connection.getMetaData().getURL());
            }
        }
        jdbc.execute("DELETE FROM audit_logs");
        jdbc.execute("DELETE FROM notifications");
        jdbc.execute("DELETE FROM prescription_items");
        jdbc.execute("DELETE FROM prescriptions");
        jdbc.execute("DELETE FROM medical_records");
        jdbc.execute("DELETE FROM appointments");
        jdbc.execute("DELETE FROM doctor_schedules");
        patients.deleteAll();
        doctors.deleteAll();
        specialties.deleteAll();
        users.deleteAll();
        actors.clear();
        tokens.clear();
        secrets.clear();
        password = UUID.randomUUID().toString();
        hash = passwords.encode(password);
        secrets.add(password);
        secrets.add(hash);
        for (Role role : Role.values()) {
            actors.put(role, seed(role, "User " + role));
        }
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

    // ==========================================
    // PERSONAL PROFILE: GET & PATCH /api/v1/me/profile
    // ==========================================

    @ParameterizedTest
    @EnumSource(Role.class)
    void allRolesCanGetOwnProfile(Role role) throws Exception {
        var response = call("GET", "/api/v1/me/profile", null, role);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode data = body(response).path("data");
        assertThat(data.path("id").asString()).isEqualTo(actors.get(role).getId().toString());
        assertThat(data.path("email").asString()).isEqualTo(actors.get(role).getEmail());
        assertThat(data.path("fullName").asString()).isEqualTo(actors.get(role).getFullName());
        assertThat(data.path("role").asString()).isEqualTo(role.name());
        assertThat(data.path("status").asString()).isEqualTo("ACTIVE");
        assertThat(data.path("phone").isNull()).isTrue();
        assertThat(data.path("address").isNull()).isTrue();
        assertThat(data.has("passwordHash")).isFalse();
    }

    @Test
    void getProfileRequiresAuthentication() throws Exception {
        problem(call("GET", "/api/v1/me/profile", null, null), 401, "AUTHENTICATION_REQUIRED");
        problem(request("GET", "/api/v1/me/profile", null, "invalid-token", Map.of()), 401, "INVALID_ACCESS_TOKEN");
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void allRolesCanUpdateOwnFullName(Role role) throws Exception {
        String newName = "Updated Name " + role;
        var response = call("PATCH", "/api/v1/me/profile", Map.of("fullName", newName), role);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode data = body(response).path("data");
        assertThat(data.path("fullName").asString()).isEqualTo(newName);
        assertThat(data.path("role").asString()).isEqualTo(role.name());

        // Verify in DB
        User updated = users.findById(actors.get(role).getId()).orElseThrow();
        assertThat(updated.getFullName()).isEqualTo(newName);

        // Verify other users unaffected
        for (Role other : Role.values()) {
            if (other != role) {
                User unaffected = users.findById(actors.get(other).getId()).orElseThrow();
                assertThat(unaffected.getFullName()).isEqualTo("User " + other);
            }
        }
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void allRolesCanUpdateProfileWithPhoneAndAddress(Role role) throws Exception {
        String newName = "Full Profile " + role;
        String phone = "0912345678";
        String address = "123 Giải Phóng, Hà Nội";
        var response = call("PATCH", "/api/v1/me/profile",
                Map.of("fullName", newName, "phone", phone, "address", address), role);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode data = body(response).path("data");
        assertThat(data.path("fullName").asString()).isEqualTo(newName);
        assertThat(data.path("phone").asString()).isEqualTo(phone);
        assertThat(data.path("address").asString()).isEqualTo(address);

        User updated = users.findById(actors.get(role).getId()).orElseThrow();
        assertThat(updated.getFullName()).isEqualTo(newName);
        assertThat(updated.getPhone()).isEqualTo(phone);
        assertThat(updated.getAddress()).isEqualTo(address);

        // Verify clearing phone and address with blank strings
        var clearResponse = call("PATCH", "/api/v1/me/profile",
                Map.of("fullName", newName, "phone", "   ", "address", ""), role);
        assertThat(clearResponse.statusCode()).isEqualTo(200);
        JsonNode clearData = body(clearResponse).path("data");
        assertThat(clearData.path("phone").isNull()).isTrue();
        assertThat(clearData.path("address").isNull()).isTrue();

        User cleared = users.findById(actors.get(role).getId()).orElseThrow();
        assertThat(cleared.getPhone()).isNull();
        assertThat(cleared.getAddress()).isNull();
    }

    @Test
    void patchProfileValidationFailures() throws Exception {
        // Blank full name
        problem(call("PATCH", "/api/v1/me/profile", Map.of("fullName", "   "), Role.PATIENT), 400, "VALIDATION_FAILED");
        // Empty full name
        problem(call("PATCH", "/api/v1/me/profile", Map.of("fullName", ""), Role.PATIENT), 400, "VALIDATION_FAILED");
        // Too long full name > 120 chars
        problem(call("PATCH", "/api/v1/me/profile", Map.of("fullName", "a".repeat(121)), Role.PATIENT), 400, "VALIDATION_FAILED");
        // Too long phone > 24 chars
        problem(call("PATCH", "/api/v1/me/profile", Map.of("fullName", "Valid Name", "phone", "0".repeat(25)), Role.PATIENT), 400, "VALIDATION_FAILED");
        // Too long address > 255 chars
        problem(call("PATCH", "/api/v1/me/profile", Map.of("fullName", "Valid Name", "address", "a".repeat(256)), Role.PATIENT), 400, "VALIDATION_FAILED");
    }

    @Test
    void patchProfileCannotModifyIdEmailRoleOrStatus() throws Exception {
        // Because Jackson fail-on-unknown-properties is true, passing unmapped properties causes 400
        var response = call("PATCH", "/api/v1/me/profile",
                Map.of("fullName", "Legit Name", "role", "ADMIN", "email", "admin@steal.com"), Role.PATIENT);
        assertThat(response.statusCode()).isEqualTo(400);

        // User role and email remain untouched
        User patientUser = users.findById(actors.get(Role.PATIENT).getId()).orElseThrow();
        assertThat(patientUser.getRole()).isEqualTo(Role.PATIENT);
        assertThat(patientUser.getEmail()).isEqualTo(actors.get(Role.PATIENT).getEmail());
    }

    @ParameterizedTest
    @ValueSource(strings = {"id", "email", "role", "status", "password", "passwordHash", "userId"})
    void profileRejectsEachReadOnlyFieldWithoutChangingAccount(String field) throws Exception {
        User original = users.findById(actors.get(Role.PATIENT).getId()).orElseThrow();
        problem(call("PATCH", "/api/v1/me/profile",
                Map.of("fullName", "Rejected Update", field, "1"), Role.PATIENT), 400, "HTTP_400");
        User unchanged = users.findById(original.getId()).orElseThrow();
        assertThat(unchanged.getFullName()).isEqualTo(original.getFullName());
        assertThat(unchanged.getEmail()).isEqualTo(original.getEmail());
        assertThat(unchanged.getRole()).isEqualTo(original.getRole());
        assertThat(unchanged.getStatus()).isEqualTo(original.getStatus());
        assertThat(Objects.equals(unchanged.getPasswordHash(), original.getPasswordHash())).isTrue();
    }

    @Test
    void linkedPatientAndAccountProfilesStayIndependentInBothDirections() throws Exception {
        String id = createPatient("PT_NO_SYNC", "Administrative Name", null, null,
                "0901111111", "Administrative Address", true, actors.get(Role.PATIENT).getId());
        var accountUpdate = call("PATCH", "/api/v1/me/profile", Map.of("fullName", "Account Name",
                "phone", "0902222222", "address", "Account Address"), Role.PATIENT);
        assertThat(accountUpdate.statusCode()).isEqualTo(200);
        JsonNode patient = body(call("GET", "/api/v1/patients/" + id, null, Role.PATIENT)).path("data");
        assertThat(patient.path("fullName").asString()).isEqualTo("Administrative Name");
        assertThat(patient.path("phone").asString()).isEqualTo("0901111111");
        assertThat(patient.path("address").asString()).isEqualTo("Administrative Address");

        assertThat(call("PATCH", "/api/v1/patients/" + id, Map.of("fullName", "Changed Patient",
                "phone", "0903333333", "address", "Changed Address"), Role.RECEPTIONIST).statusCode()).isEqualTo(200);
        JsonNode account = body(call("GET", "/api/v1/me/profile", null, Role.PATIENT)).path("data");
        assertThat(account.path("fullName").asString()).isEqualTo("Account Name");
        assertThat(account.path("phone").asString()).isEqualTo("0902222222");
        assertThat(account.path("address").asString()).isEqualTo("Account Address");
    }

    @Test
    void profileFormClearsOmittedContactsAndRequiresFullName() throws Exception {
        assertThat(call("PATCH", "/api/v1/me/profile", Map.of("fullName", "Form Name",
                "phone", "0902222222", "address", "Form Address"), Role.PATIENT).statusCode()).isEqualTo(200);
        problem(call("PATCH", "/api/v1/me/profile", Map.of("phone", "0903333333"), Role.PATIENT),
                400, "VALIDATION_FAILED");
        var response = call("PATCH", "/api/v1/me/profile", Map.of("fullName", "Form Name"), Role.PATIENT);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(body(response).path("data").path("phone").isNull()).isTrue();
        assertThat(body(response).path("data").path("address").isNull()).isTrue();
    }

    // ==========================================
    // PATIENTS: GET /api/v1/patients
    // ==========================================

    @Test
    void listPatientsRolePermissions() throws Exception {
        // ADMIN: 200
        var adminRes = call("GET", "/api/v1/patients", null, Role.ADMIN);
        assertThat(adminRes.statusCode()).isEqualTo(200);

        // RECEPTIONIST: 200
        var recepRes = call("GET", "/api/v1/patients", null, Role.RECEPTIONIST);
        assertThat(recepRes.statusCode()).isEqualTo(200);

        // DOCTOR: 403
        problem(call("GET", "/api/v1/patients", null, Role.DOCTOR), 403, "ACCESS_DENIED");

        // PATIENT: 403
        problem(call("GET", "/api/v1/patients", null, Role.PATIENT), 403, "ACCESS_DENIED");

        // Anonymous: 401
        problem(call("GET", "/api/v1/patients", null, null), 401, "AUTHENTICATION_REQUIRED");
    }

    @Test
    void listPatientsSearchPaginationAndFilter() throws Exception {
        createPatient("PT_001", "Alice Smith", "1990-01-01", "FEMALE", "0901111111", "Hanoi", true, null);
        createPatient("PT_002", "Bob Jones", "1985-05-05", "MALE", "0902222222", "Danang", true, null);
        createPatient("PT_003", "Charlie Brown", "2000-10-10", "OTHER", "0901111111", "HCM", false, null);

        // All active + inactive
        JsonNode all = listPatients("", null, 0, 10);
        assertThat(all.path("totalElements").asLong()).isEqualTo(3);

        // Filter active only
        JsonNode activeOnly = listPatients("", true, 0, 10);
        assertThat(activeOnly.path("totalElements").asLong()).isEqualTo(2);

        // Filter inactive only
        JsonNode inactiveOnly = listPatients("", false, 0, 10);
        assertThat(inactiveOnly.path("totalElements").asLong()).isEqualTo(1);
        assertThat(inactiveOnly.path("items").get(0).path("patientCode").asString()).isEqualTo("PT_003");

        // Search by name
        JsonNode searchName = listPatients("Alice", null, 0, 10);
        assertThat(searchName.path("totalElements").asLong()).isEqualTo(1);
        assertThat(searchName.path("items").get(0).path("fullName").asString()).isEqualTo("Alice Smith");

        // Search by phone (shared phone 0901111111)
        JsonNode searchPhone = listPatients("0901111111", null, 0, 10);
        assertThat(searchPhone.path("totalElements").asLong()).isEqualTo(2);

        // Search by patientCode
        JsonNode searchCode = listPatients("PT_002", null, 0, 10);
        assertThat(searchCode.path("totalElements").asLong()).isEqualTo(1);
        assertThat(searchCode.path("items").get(0).path("patientCode").asString()).isEqualTo("PT_002");

        // Pagination
        JsonNode page0 = listPatients("", null, 0, 2);
        assertThat(page0.path("items").size()).isEqualTo(2);
        assertThat(page0.path("totalPages").asInt()).isEqualTo(2);

        JsonNode page1 = listPatients("", null, 1, 2);
        assertThat(page1.path("items").size()).isEqualTo(1);
    }

    // ==========================================
    // PATIENTS: POST /api/v1/patients
    // ==========================================

    @Test
    void createPatientSuccessWalkin() throws Exception {
        Map<String, Object> payload = Map.of(
                "patientCode", "PT_WALK01",
                "fullName", "Nguyen Van Walkin",
                "dateOfBirth", "1995-03-20",
                "sex", "MALE",
                "phone", "0912345678",
                "address", "123 Street",
                "isActive", true
        );
        var response = call("POST", "/api/v1/patients", payload, Role.RECEPTIONIST);
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.headers().firstValue("Location").orElse("")).matches("/api/v1/patients/[0-9]+");

        JsonNode data = body(response).path("data");
        assertThat(data.path("patientCode").asString()).isEqualTo("PT_WALK01");
        assertThat(data.path("fullName").asString()).isEqualTo("Nguyen Van Walkin");
        assertThat(data.path("dateOfBirth").asString()).isEqualTo("1995-03-20");
        assertThat(data.path("sex").asString()).isEqualTo("MALE");
        assertThat(data.path("phone").asString()).isEqualTo("0912345678");
        assertThat(data.path("isActive").asBoolean()).isTrue();
        assertThat(data.path("userId").isNull()).isTrue();
    }

    @Test
    void createPatientSuccessWithLinkedUser() throws Exception {
        User patientUser = actors.get(Role.PATIENT);
        Map<String, Object> payload = Map.of(
                "userId", patientUser.getId().toString(),
                "patientCode", "PT_LINKED",
                "fullName", "Linked Patient",
                "dateOfBirth", "1992-07-15",
                "sex", "FEMALE",
                "phone", "0987654321",
                "address", "456 Avenue"
        );
        var response = call("POST", "/api/v1/patients", payload, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(201);
        JsonNode data = body(response).path("data");
        assertThat(data.path("userId").asString()).isEqualTo(patientUser.getId().toString());
    }

    @Test
    void createPatientAutoGeneratesPatientCodeIfOmitted() throws Exception {
        Map<String, Object> payload = Map.of(
                "fullName", "Auto Code Patient",
                "phone", "0933333333"
        );
        var response = call("POST", "/api/v1/patients", payload, Role.RECEPTIONIST);
        assertThat(response.statusCode()).isEqualTo(201);
        JsonNode data = body(response).path("data");
        assertThat(data.path("patientCode").asString()).startsWith("PAT");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   "})
    void createPatientAutoGeneratesPatientCodeForNullOrBlankInput(String code) throws Exception {
        Map<String, Object> payload = new HashMap<>();
        payload.put("fullName", "Generated Code Patient");
        payload.put("patientCode", code);
        var response = call("POST", "/api/v1/patients", payload, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(body(response).path("data").path("patientCode").asString()).matches("PAT[0-9]{6,}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"INVALID CODE", "PAT/001", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567"})
    void createPatientStillRejectsMalformedNonblankCodes(String code) throws Exception {
        problem(call("POST", "/api/v1/patients", Map.of("fullName", "Invalid Code Patient",
                "patientCode", code), Role.ADMIN), 400, "VALIDATION_FAILED");
        assertThat(patients.count()).isZero();
    }

    @Test
    void createPatientSamePhoneAllowedForMultiplePatients() throws Exception {
        Map<String, Object> p1 = Map.of("patientCode", "PT_PH1", "fullName", "Parent", "phone", "0900000000");
        Map<String, Object> p2 = Map.of("patientCode", "PT_PH2", "fullName", "Child", "phone", "0900000000");

        assertThat(call("POST", "/api/v1/patients", p1, Role.RECEPTIONIST).statusCode()).isEqualTo(201);
        assertThat(call("POST", "/api/v1/patients", p2, Role.RECEPTIONIST).statusCode()).isEqualTo(201);
    }

    @Test
    void createPatientFailsOnDuplicateCode() throws Exception {
        createPatient("PT_DUP", "Original", "1990-01-01", "MALE", "0911111111", "Addr", true, null);
        Map<String, Object> dup = Map.of("patientCode", "PT_DUP", "fullName", "Duplicate", "phone", "0922222222");
        problem(call("POST", "/api/v1/patients", dup, Role.RECEPTIONIST), 409, "PATIENT_CODE_EXISTS");
    }

    @Test
    void createPatientFailsOnFutureDateOfBirth() throws Exception {
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        Map<String, Object> payload = Map.of(
                "fullName", "Future Person",
                "dateOfBirth", tomorrow.toString()
        );
        problem(call("POST", "/api/v1/patients", payload, Role.RECEPTIONIST), 400, "VALIDATION_FAILED");
    }

    @Test
    void createPatientFailsIfUserAlreadyLinked() throws Exception {
        User patientUser = actors.get(Role.PATIENT);
        createPatient("PT_L1", "First Link", "1990-01-01", "FEMALE", "0911111111", null, true, patientUser.getId());

        Map<String, Object> payload = Map.of(
                "userId", patientUser.getId().toString(),
                "patientCode", "PT_L2",
                "fullName", "Second Link"
        );
        problem(call("POST", "/api/v1/patients", payload, Role.RECEPTIONIST), 409, "USER_ALREADY_LINKED");
    }

    @Test
    void createPatientFailsIfUserNotPatientRole() throws Exception {
        User doctorUser = actors.get(Role.DOCTOR);
        Map<String, Object> payload = Map.of(
                "userId", doctorUser.getId().toString(),
                "patientCode", "PT_DOCTOR",
                "fullName", "Doctor Trying To Be Patient"
        );
        problem(call("POST", "/api/v1/patients", payload, Role.ADMIN), 409, "USER_NOT_ELIGIBLE");
    }

    @Test
    void createPatientFailsIfUserDisabled() throws Exception {
        User disabledUser = seed(Role.PATIENT, "Disabled Patient User");
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", disabledUser.getId());

        Map<String, Object> payload = Map.of(
                "userId", disabledUser.getId().toString(),
                "patientCode", "PT_DIS",
                "fullName", "Disabled User Link"
        );
        problem(call("POST", "/api/v1/patients", payload, Role.ADMIN), 409, "USER_NOT_ACTIVE");
    }

    @Test
    void createPatientFailsIfUserNotFound() throws Exception {
        Map<String, Object> payload = Map.of(
                "userId", "999999999",
                "patientCode", "PT_NONE",
                "fullName", "Non Existent User"
        );
        problem(call("POST", "/api/v1/patients", payload, Role.ADMIN), 404, "RESOURCE_NOT_FOUND");
    }

    @Test
    void createPatientForbiddenForDoctorAndPatient() throws Exception {
        Map<String, Object> payload = Map.of("fullName", "Unauthorized");
        problem(call("POST", "/api/v1/patients", payload, Role.DOCTOR), 403, "ACCESS_DENIED");
        problem(call("POST", "/api/v1/patients", payload, Role.PATIENT), 403, "ACCESS_DENIED");
    }

    // ==========================================
    // PATIENTS: GET /api/v1/patients/{id}
    // ==========================================

    @Test
    void getPatientByIdAdminAndReceptionist() throws Exception {
        String id = createPatient("PT_FIND", "Find Me", "1991-02-02", "FEMALE", "0911223344", "Address", true, null);

        var adminRes = call("GET", "/api/v1/patients/" + id, null, Role.ADMIN);
        assertThat(adminRes.statusCode()).isEqualTo(200);
        assertThat(body(adminRes).path("data").path("id").asString()).isEqualTo(id);

        var recepRes = call("GET", "/api/v1/patients/" + id, null, Role.RECEPTIONIST);
        assertThat(recepRes.statusCode()).isEqualTo(200);
        assertThat(body(recepRes).path("data").path("id").asString()).isEqualTo(id);
    }

    @Test
    void getPatientByIdDoctorDenied() throws Exception {
        String id = createPatient("PT_DOC", "Doctor Cant See", "1991-02-02", "FEMALE", "0911223344", "Address", true, null);
        problem(call("GET", "/api/v1/patients/" + id, null, Role.DOCTOR), 403, "ACCESS_DENIED");
    }

    @Test
    void getPatientByIdPatientOwnership() throws Exception {
        User patientUser = actors.get(Role.PATIENT);
        String ownId = createPatient("PT_OWN", "My Profile", "1990-01-01", "FEMALE", "0900000001", "Home", true, patientUser.getId());
        String otherId = createPatient("PT_OTHER", "Someone Else", "1980-01-01", "MALE", "0900000002", "Other", true, null);

        // Own profile: 200
        var ownRes = call("GET", "/api/v1/patients/" + ownId, null, Role.PATIENT);
        assertThat(ownRes.statusCode()).isEqualTo(200);
        assertThat(body(ownRes).path("data").path("id").asString()).isEqualTo(ownId);

        // Other profile: 404 (does not leak existence of other patient)
        problem(call("GET", "/api/v1/patients/" + otherId, null, Role.PATIENT), 404, "RESOURCE_NOT_FOUND");
    }

    @Test
    void getPatientByIdNotFound() throws Exception {
        problem(call("GET", "/api/v1/patients/999999", null, Role.ADMIN), 404, "RESOURCE_NOT_FOUND");
    }

    // ==========================================
    // PATIENTS: GET /api/v1/me/patient-profile
    // ==========================================

    @Test
    void getMePatientProfileSuccessForLinkedPatient() throws Exception {
        User patientUser = actors.get(Role.PATIENT);
        String patientId = createPatient("PT_ME", "My Patient Info", "1995-05-05", "FEMALE", "0944444444", "Hanoi", true, patientUser.getId());

        var response = call("GET", "/api/v1/me/patient-profile", null, Role.PATIENT);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode data = body(response).path("data");
        assertThat(data.path("id").asString()).isEqualTo(patientId);
        assertThat(data.path("patientCode").asString()).isEqualTo("PT_ME");
        assertThat(data.path("fullName").asString()).isEqualTo("My Patient Info");
        assertThat(data.path("userId").asString()).isEqualTo(patientUser.getId().toString());
    }

    @Test
    void getMePatientProfileNotFoundWhenUnlinked() throws Exception {
        // Patient has no linked patient profile yet
        problem(call("GET", "/api/v1/me/patient-profile", null, Role.PATIENT), 404, "RESOURCE_NOT_FOUND");
    }

    @Test
    void getMePatientProfileDeniedForStaff() throws Exception {
        problem(call("GET", "/api/v1/me/patient-profile", null, Role.ADMIN), 403, "ACCESS_DENIED");
        problem(call("GET", "/api/v1/me/patient-profile", null, Role.RECEPTIONIST), 403, "ACCESS_DENIED");
        problem(call("GET", "/api/v1/me/patient-profile", null, Role.DOCTOR), 403, "ACCESS_DENIED");
    }

    // ==========================================
    // PATIENTS: PATCH /api/v1/patients/{id}
    // ==========================================

    @Test
    void patchPatientSuccess() throws Exception {
        String id = createPatient("PT_PATCH", "Original Name", "1990-01-01", "MALE", "0911111111", "Old Addr", true, null);

        Map<String, Object> patch = Map.of(
                "fullName", "Updated Name",
                "phone", "0999999999",
                "address", "New Addr",
                "isActive", false
        );
        var response = call("PATCH", "/api/v1/patients/" + id, patch, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(200);

        JsonNode data = body(response).path("data");
        assertThat(data.path("fullName").asString()).isEqualTo("Updated Name");
        assertThat(data.path("phone").asString()).isEqualTo("0999999999");
        assertThat(data.path("address").asString()).isEqualTo("New Addr");
        assertThat(data.path("isActive").asBoolean()).isFalse();
    }

    @Test
    void patchPatientLinkUser() throws Exception {
        String id = createPatient("PT_LINK_LATER", "Unlinked Guy", "1990-01-01", "MALE", "0911111111", "Addr", true, null);
        User patientUser = actors.get(Role.PATIENT);

        var response = call("PATCH", "/api/v1/patients/" + id, Map.of("userId", patientUser.getId().toString()), Role.RECEPTIONIST);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(body(response).path("data").path("userId").asString()).isEqualTo(patientUser.getId().toString());

        // Now GET /me/patient-profile returns this patient
        var meRes = call("GET", "/api/v1/me/patient-profile", null, Role.PATIENT);
        assertThat(meRes.statusCode()).isEqualTo(200);
        assertThat(body(meRes).path("data").path("id").asString()).isEqualTo(id);
    }

    @Test
    void patchPatientEmptyPayloadValidation() throws Exception {
        String id = createPatient("PT_EMPTY", "Empty Test", "1990-01-01", "MALE", "0911111111", "Addr", true, null);
        problem(call("PATCH", "/api/v1/patients/" + id, Map.of(), Role.ADMIN), 400, "VALIDATION_FAILED");
    }

    @Test
    void patchPatientFutureDobValidation() throws Exception {
        String id = createPatient("PT_FUT", "Fut Test", "1990-01-01", "MALE", "0911111111", "Addr", true, null);
        problem(call("PATCH", "/api/v1/patients/" + id, Map.of("dateOfBirth", "2099-12-31"), Role.ADMIN), 400, "VALIDATION_FAILED");
    }

    @Test
    void patchPatientForbiddenForDoctorAndPatient() throws Exception {
        String id = createPatient("PT_NO_EDIT", "No Edit", "1990-01-01", "MALE", "0911111111", "Addr", true, null);
        problem(call("PATCH", "/api/v1/patients/" + id, Map.of("fullName", "Hacked"), Role.DOCTOR), 403, "ACCESS_DENIED");
        problem(call("PATCH", "/api/v1/patients/" + id, Map.of("fullName", "Hacked"), Role.PATIENT), 403, "ACCESS_DENIED");
    }

    @Test
    void deletePatientIsForbidden() throws Exception {
        String id = createPatient("PT_NO_DEL", "No Delete", "1990-01-01", "MALE", "0911111111", "Addr", true, null);
        problem(call("DELETE", "/api/v1/patients/" + id, null, Role.ADMIN), 403, "ACCESS_DENIED");
    }

    @Test
    void deactivationAndRestorationPreservePatientIdentityAndLinkedAccount() throws Exception {
        User linked = actors.get(Role.PATIENT);
        String id = createPatient("PT_RESTORE", "Preserved Patient", "1990-01-01", "OTHER",
                "0901111111", "Preserved Address", true, linked.getId());
        for (boolean active : List.of(false, true)) {
            var response = call("PATCH", "/api/v1/patients/" + id, Map.of("isActive", active), Role.RECEPTIONIST);
            assertThat(response.statusCode()).isEqualTo(200);
            JsonNode data = body(response).path("data");
            assertThat(data.path("id").asString()).isEqualTo(id);
            assertThat(data.path("userId").asString()).isEqualTo(linked.getId().toString());
            assertThat(data.path("patientCode").asString()).isEqualTo("PT_RESTORE");
            assertThat(data.path("fullName").asString()).isEqualTo("Preserved Patient");
            assertThat(data.path("phone").asString()).isEqualTo("0901111111");
            assertThat(data.path("address").asString()).isEqualTo("Preserved Address");
            assertThat(data.path("dateOfBirth").asString()).isEqualTo("1990-01-01");
            assertThat(data.path("isActive").asBoolean()).isEqualTo(active);
            assertThat(call("GET", "/api/v1/me/patient-profile", null, Role.PATIENT).statusCode()).isEqualTo(200);
            assertThat(users.findById(linked.getId()).orElseThrow().getStatus()).isEqualTo(UserStatus.ACTIVE);
            assertThat(patients.count()).isEqualTo(1);
        }
    }

    // ==========================================
    // CONCURRENCY & RACE CONDITIONS
    // ==========================================

    @Test
    void concurrentLinkSameUserToOneOfTwoPatients() throws Exception {
        User candidate = seed(Role.PATIENT, "Concurrent Candidate");
        String p1 = createPatient("PT_C1", "Patient C1", null, null, null, null, true, null);
        String p2 = createPatient("PT_C2", "Patient C2", null, null, null, null, true, null);

        var start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var f1 = executor.submit(() -> {
                start.await();
                return call("PATCH", "/api/v1/patients/" + p1, Map.of("userId", candidate.getId().toString()), Role.ADMIN);
            });
            var f2 = executor.submit(() -> {
                start.await();
                return call("PATCH", "/api/v1/patients/" + p2, Map.of("userId", candidate.getId().toString()), Role.ADMIN);
            });
            start.countDown();
            assertThat(List.of(f1.get().statusCode(), f2.get().statusCode())).containsExactlyInAnyOrder(200, 409);
        }
    }

    // ==========================================
    // HELPERS
    // ==========================================

    private String createPatient(String code, String name, String dob, String sex, String phone,
            String address, boolean active, Long userId) throws Exception {
        Map<String, Object> payload = new HashMap<>();
        if (code != null) payload.put("patientCode", code);
        payload.put("fullName", name);
        if (dob != null) payload.put("dateOfBirth", dob);
        if (sex != null) payload.put("sex", sex);
        if (phone != null) payload.put("phone", phone);
        if (address != null) payload.put("address", address);
        payload.put("isActive", active);
        if (userId != null) payload.put("userId", userId.toString());

        var response = call("POST", "/api/v1/patients", payload, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(201);
        return body(response).path("data").path("id").asString();
    }

    private JsonNode listPatients(String q, Boolean active, int page, int size) throws Exception {
        StringBuilder query = new StringBuilder("/api/v1/patients?page=").append(page).append("&size=").append(size);
        if (!q.isEmpty()) query.append("&q=").append(q);
        if (active != null) query.append("&isActive=").append(active);
        var response = call("GET", query.toString(), null, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(200);
        return body(response).path("data");
    }

    private JsonNode body(HttpResponse<String> response) {
        return mapper.readTree(response.body());
    }

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
            var response = request("POST", "/api/v1/auth/login",
                    Map.of("email", actors.get(role).getEmail(), "password", password), null, Map.of());
            assertThat(response.statusCode()).isEqualTo(200);
            String token = body(response).path("data").path("accessToken").asString();
            tokens.put(role, token);
            secrets.add(token);
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
