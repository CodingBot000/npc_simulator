package com.npcsimulator.api.controller;

import com.npcsimulator.api.dto.ErrorResponse;
import com.npcsimulator.review.ReviewApiException;
import com.npcsimulator.runtime.RuntimeApiException;
import jakarta.validation.ConstraintViolationException;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException error) {
        String message = error.getBindingResult().getFieldErrors().stream()
            .map(fieldError -> fieldError.getField() + " " + fieldError.getDefaultMessage())
            .collect(Collectors.joining(", "));
        if (message.isBlank()) {
            message = "요청 본문이 API 계약과 맞지 않습니다.";
        }
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ErrorResponse(message));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintViolation(ConstraintViolationException error) {
        String message = error.getConstraintViolations().stream()
            .map(violation -> violation.getPropertyPath() + " " + violation.getMessage())
            .collect(Collectors.joining(", "));
        if (message.isBlank()) {
            message = "요청 값이 API 계약과 맞지 않습니다.";
        }
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ErrorResponse(message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadableMessage(HttpMessageNotReadableException error) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ErrorResponse("요청 JSON을 읽을 수 없습니다."));
    }

    @ExceptionHandler(RuntimeApiException.class)
    public ResponseEntity<ErrorResponse> handleRuntimeApi(RuntimeApiException error) {
        return ResponseEntity.status(error.getStatus())
            .body(new ErrorResponse(error.getMessage()));
    }

    @ExceptionHandler(ReviewApiException.class)
    public ResponseEntity<ErrorResponse> handleReviewApi(ReviewApiException error) {
        return ResponseEntity.status(error.getStatus())
            .body(new ErrorResponse(error.getMessage()));
    }
}
