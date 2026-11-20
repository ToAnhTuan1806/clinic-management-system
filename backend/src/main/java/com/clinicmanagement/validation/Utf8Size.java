package com.clinicmanagement.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = Utf8SizeValidator.class)
public @interface Utf8Size {
    int max();
    String message() default "Invalid value.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
