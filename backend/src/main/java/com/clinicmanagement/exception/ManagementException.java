package com.clinicmanagement.exception;

import org.springframework.http.HttpStatus;

public class ManagementException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ManagementException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }

    public static ManagementException missing() {
        return new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource was not found.");
    }

    public static ManagementException conflict(String code, String detail) {
        return new ManagementException(HttpStatus.CONFLICT, code, detail);
    }
}
