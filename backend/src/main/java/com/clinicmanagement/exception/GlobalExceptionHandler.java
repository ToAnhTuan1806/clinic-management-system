package com.clinicmanagement.exception;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ProblemDetail> handleAccessDenied(ServletWebRequest request) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiProblems.create(HttpStatus.FORBIDDEN,
                "ACCESS_DENIED", "Access is denied.", request.getRequest().getRequestURI()));
    }

    @ExceptionHandler(AuthApiException.class)
    ResponseEntity<ProblemDetail> handleAuthException(AuthApiException exception, ServletWebRequest request) {
        return ResponseEntity.status(exception.getStatus()).header("Cache-Control", "no-store")
                .body(ApiProblems.create(exception.getStatus(), exception.getCode(), exception.getMessage(),
                        request.getRequest().getRequestURI()));
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception exception, Object body,
            HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        HttpStatus status = HttpStatus.valueOf(statusCode.value());
        String path = ((ServletWebRequest) request).getRequest().getRequestURI();
        ProblemDetail problem = ApiProblems.create(status, "HTTP_" + status.value(),
                status.getReasonPhrase(), path);
        if (exception instanceof MethodArgumentNotValidException validationException) {
            problem.setProperty("code", "VALIDATION_FAILED");
            List<Map<String, String>> errors = validationException.getBindingResult().getFieldErrors().stream()
                    .map(error -> Map.of("field", error.getField(), "message", "Invalid value."))
                    .toList();
            problem.setProperty("errors", errors);
        }
        return super.handleExceptionInternal(exception, problem, headers, statusCode, request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpectedException(Exception exception, ServletWebRequest request) {
        // Exception messages/stack traces may contain request credentials or SQL values.
        logger.error("Unhandled API exception type: " + exception.getClass().getSimpleName());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ApiProblems.create(
                HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "An unexpected error occurred.",
                request.getRequest().getRequestURI()));
    }
}
