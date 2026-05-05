package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class RuntimeWorldService {

    private static final long READ_WAIT_TIMEOUT_MS = 5_000L;
    private static final long READ_WAIT_INTERVAL_MS = 100L;

    private final RuntimeWorldRepository runtimeWorldRepository;
    private final RuntimeBridgeClient bridgeClient;
    private final RuntimeWorldSnapshotBuilder snapshotBuilder;
    private final RuntimeExportArtifactCleaner artifactCleaner;
    private final BackendRuntimeLayout runtimeLayout;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;
    private final boolean postgresDatasource;
    private final Set<String> activeMutationInstances = ConcurrentHashMap.newKeySet();

    public RuntimeWorldService(
        RuntimeWorldRepository runtimeWorldRepository,
        RuntimeBridgeClient bridgeClient,
        RuntimeWorldSnapshotBuilder snapshotBuilder,
        RuntimeExportArtifactCleaner artifactCleaner,
        BackendRuntimeLayout runtimeLayout,
        ObjectMapper objectMapper,
        PlatformTransactionManager transactionManager,
        @Value("${spring.datasource.url:}") String datasourceUrl
    ) {
        this.runtimeWorldRepository = runtimeWorldRepository;
        this.bridgeClient = bridgeClient;
        this.snapshotBuilder = snapshotBuilder;
        this.artifactCleaner = artifactCleaner;
        this.runtimeLayout = runtimeLayout;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.postgresDatasource = datasourceUrl != null && datasourceUrl.matches("^(?:jdbc:)?postgres(?:ql)?:.*");
    }

    public JsonNode getWorld(HttpHeaders headers) {
        if (!postgresDatasource) {
            return bridgeClient.invokeBridgeBody("world", headers, null);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        RuntimeWorldRecord record = ensureRuntimeRecord(instanceId);
        return snapshotBuilder.buildWorldSnapshot(record.bundle());
    }

    public JsonNode getInspector(HttpHeaders headers) {
        if (!postgresDatasource) {
            return bridgeClient.invokeBridgeBody("inspector", headers, null);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        RuntimeWorldRecord record = ensureRuntimeRecord(instanceId);
        return snapshotBuilder.buildInspector(record.bundle());
    }

    public JsonNode resetWorld(HttpHeaders headers) {
        if (!postgresDatasource) {
            return bridgeClient.invokeBridgeBody("reset", headers, null);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        RuntimeWorldRecord record = withLocalMutationGuard(
            instanceId,
            () -> withMutationLock(instanceId, () -> {
                Optional<RuntimeWorldRecord> existing = runtimeWorldRepository.findLatest(instanceId);
                RuntimeWorldBundle seedBundle = bridgeClient.requestSeedBundle();
                return runtimeWorldRepository.save(
                    instanceId,
                    seedBundle,
                    existing.orElse(null),
                    resolveLegacyStoragePath(instanceId)
                );
            })
        );

        return snapshotBuilder.buildWorldSnapshot(record.bundle());
    }

    public JsonNode interact(HttpHeaders headers, Object requestBody) {
        if (!postgresDatasource) {
            return bridgeClient.invokeBridgeBody("interact", headers, requestBody);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        JsonNode request = objectMapper.valueToTree(requestBody);
        return withLocalMutationGuard(instanceId, () -> {
            RuntimeWorldRecord current = ensureRuntimeRecord(instanceId);
            JsonNode workerResult = bridgeClient.requestInteractionWorker(request, current.bundle());
            RuntimeWorldBundle nextBundle = bridgeClient.parseBundle(workerResult.path("nextBundle"));
            JsonNode cleanupPaths = workerResult.get("cleanupExportPaths");

            try {
                RuntimeWorldRecord saved = withMutationLock(instanceId, () -> {
                    RuntimeWorldRecord latest = runtimeWorldRepository.findLatest(instanceId)
                        .orElseThrow(() -> new RuntimeApiException(
                            HttpStatus.CONFLICT,
                            "World state is busy for this instance."
                        ));
                    ensureCurrentRecordUnchanged(current, latest);
                    return runtimeWorldRepository.save(
                        instanceId,
                        nextBundle,
                        latest,
                        resolveLegacyStoragePath(instanceId)
                    );
                });
                return snapshotBuilder.buildInteractionResponse(workerResult, saved.bundle());
            } catch (RuntimeException error) {
                artifactCleaner.cleanupExportArtifacts(cleanupPaths);
                throw error;
            }
        });
    }

    private RuntimeWorldRecord ensureRuntimeRecord(String instanceId) {
        Optional<RuntimeWorldRecord> direct = runtimeWorldRepository.findLatest(instanceId);
        if (direct.isPresent()) {
            return direct.get();
        }

        try {
            return withMutationLock(instanceId, () -> ensureRuntimeRecordLocked(instanceId));
        } catch (RuntimeApiException error) {
            if (error.getStatus() != HttpStatus.CONFLICT) {
                throw error;
            }
        }

        long startedAt = System.currentTimeMillis();
        while (System.currentTimeMillis() - startedAt < READ_WAIT_TIMEOUT_MS) {
            try {
                Thread.sleep(READ_WAIT_INTERVAL_MS);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new RuntimeApiException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Interrupted while waiting for runtime world state.",
                    error
                );
            }

            Optional<RuntimeWorldRecord> retry = runtimeWorldRepository.findLatest(instanceId);
            if (retry.isPresent()) {
                return retry.get();
            }
        }

        throw new RuntimeApiException(
            HttpStatus.CONFLICT,
            "World state is busy for this instance."
        );
    }

    private RuntimeWorldRecord ensureRuntimeRecordLocked(String instanceId) {
        Optional<RuntimeWorldRecord> existing = runtimeWorldRepository.findLatest(instanceId);
        if (existing.isPresent()) {
            return existing.get();
        }

        RuntimeWorldBundle seedBundle = bridgeClient.requestSeedBundle();
        return runtimeWorldRepository.save(
            instanceId,
            seedBundle,
            null,
            resolveLegacyStoragePath(instanceId)
        );
    }

    private void ensureCurrentRecordUnchanged(RuntimeWorldRecord current, RuntimeWorldRecord latest) {
        if (current.id() == latest.id() && current.stateVersion() == latest.stateVersion()) {
            return;
        }

        throw new RuntimeApiException(
            HttpStatus.CONFLICT,
            "답변 생성 중 월드 상태가 변경되었습니다. 다시 시도해주세요."
        );
    }

    private <T> T withLocalMutationGuard(String instanceId, RuntimeMutationCallback<T> callback) {
        if (!activeMutationInstances.add(instanceId)) {
            throw new RuntimeApiException(
                HttpStatus.CONFLICT,
                "World state is busy for this instance."
            );
        }

        try {
            return callback.run();
        } finally {
            activeMutationInstances.remove(instanceId);
        }
    }

    private <T> T withMutationLock(String instanceId, RuntimeMutationCallback<T> callback) {
        return transactionTemplate.execute(status -> {
            if (!runtimeWorldRepository.tryAcquireMutationLock(instanceId)) {
                throw new RuntimeApiException(
                    HttpStatus.CONFLICT,
                    "World state is busy for this instance."
                );
            }

            return callback.run();
        });
    }

    private String resolveLegacyStoragePath(String instanceId) {
        java.nio.file.Path base = runtimeLayout.dataRoot();
        if (RuntimeWorldHeaderResolver.DEFAULT_WORLD_INSTANCE_ID.equals(instanceId)) {
            return base.toString();
        }

        return base.resolve("runs").resolve(instanceId).toString();
    }

    @FunctionalInterface
    private interface RuntimeMutationCallback<T> {
        T run();
    }
}
