package com.clinicmanagement.security;

public interface GoogleIdTokenVerifier {
    GoogleUserClaims verify(String idToken);
}
