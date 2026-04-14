package com.npcsimulator.api.controller;

import com.npcsimulator.api.dto.SystemInfoResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/system")
public class SystemController {

    @GetMapping("/info")
    public SystemInfoResponse info() {
        return new SystemInfoResponse(
            "npc-simulator-backend",
            "bootstrapped",
            "phase-3-skeleton",
            List.of(
                "world endpoint port",
                "interact endpoint port",
                "reset endpoint port",
                "review endpoint port",
                "OpenAPI snapshot export"
            )
        );
    }
}
