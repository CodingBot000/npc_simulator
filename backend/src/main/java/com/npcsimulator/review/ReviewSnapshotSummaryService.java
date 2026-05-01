package com.npcsimulator.review;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
class ReviewSnapshotSummaryService {

    private static final String SNAPSHOT_SYNC_SCRIPT = "backend/scripts/review-sync-snapshots.ts";

    private final ReviewRepository reviewRepository;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewJsonSupport json;

    ReviewSnapshotSummaryService(
        ReviewRepository reviewRepository,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewJsonSupport json
    ) {
        this.reviewRepository = reviewRepository;
        this.commandRunner = commandRunner;
        this.json = json;
    }

    Optional<ReviewSnapshotSummary> getActiveSnapshotSummary(String kind) {
        Optional<ReviewRepository.SnapshotSummaryRow> direct = reviewRepository.findActiveSnapshot(kind);
        if (direct.isEmpty() && commandRunner.pathExists(commandRunner.resolveProjectPath(SNAPSHOT_SYNC_SCRIPT))) {
            try {
                commandRunner.runNodeCommand(List.of(
                    commandRunner.tsxBinary().toString(),
                    commandRunner.resolveRequiredProjectPath(SNAPSHOT_SYNC_SCRIPT).toString()
                ));
            } catch (ReviewApiException ignored) {
                // Keep the current DB view if sync-on-read fails; explicit finalize still updates snapshots.
            }
            direct = reviewRepository.findActiveSnapshot(kind);
        }

        return direct.map(row -> {
            int rowCount = reviewRepository.countSnapshotItems(row.id());
            ObjectNode manifest = json.object(row.manifestJson());
            String manifestPath =
                json.firstNonBlank(
                    row.outputUri(),
                    json.extractText(json.object(manifest.get("outputFiles")), "manifest")
                );
            return new ReviewSnapshotSummary(
                row.id(),
                row.datasetVersion(),
                row.sourceFingerprint(),
                manifestPath,
                rowCount,
                row.generatedAt()
            );
        });
    }
}

