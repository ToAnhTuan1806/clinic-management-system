package com.clinicmanagement;

import com.clinicmanagement.exception.GlobalExceptionHandler;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ApiErrorHandlingTest {
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        // Test-only controller exercises advice without opening additional application endpoints.
        mvc = MockMvcBuilders.standaloneSetup(new ErrorFixtureController())
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void validationErrorsUseSafeFieldMessages() throws Exception {
        mvc.perform(post("/fixture").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("displayName"))
                .andExpect(jsonPath("$.errors[0].message").value("Invalid value."))
                .andExpect(jsonPath("$.errors[0].rejectedValue").doesNotExist());
    }

    @Test
    void malformedJsonIsSanitized() throws Exception {
        mvc.perform(post("/fixture").contentType(MediaType.APPLICATION_JSON).content("{broken"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("about:blank"))
                .andExpect(jsonPath("$.code").value("HTTP_400"))
                .andExpect(jsonPath("$.detail").value("Bad Request"))
                .andExpect(jsonPath("$.instance").value("/fixture"));
    }

    @Test
    void unexpectedExceptionsDoNotExposeInternalDetails() throws Exception {
        mvc.perform(get("/fixture/failure"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.detail").value("An unexpected error occurred."))
                .andExpect(jsonPath("$.exception").doesNotExist())
                .andExpect(jsonPath("$.trace").doesNotExist());
    }

    @Test
    void unsupportedMethodsKeepHttpSemantics() throws Exception {
        mvc.perform(delete("/fixture"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(header().string("Allow", "POST"))
                .andExpect(jsonPath("$.code").value("HTTP_405"));
    }

    @RestController
    static class ErrorFixtureController {
        @PostMapping("/fixture")
        RequestPayload validate(@Valid @RequestBody RequestPayload payload) {
            return payload;
        }

        @GetMapping("/fixture/failure")
        void fail() {
            throw new IllegalStateException("internal-detail-that-must-not-reach-client");
        }
    }

    record RequestPayload(@NotBlank String displayName) {
    }
}
