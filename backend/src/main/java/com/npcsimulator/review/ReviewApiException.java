package com.npcsimulator.review;

import org.springframework.http.HttpStatus;

public class ReviewApiException extends RuntimeException {

    private final HttpStatus status;

    public ReviewApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public ReviewApiException(HttpStatus status, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
