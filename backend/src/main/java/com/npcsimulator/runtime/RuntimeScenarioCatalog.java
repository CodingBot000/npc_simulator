package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class RuntimeScenarioCatalog {

    private static final RuntimeScenarioMetadata UNDERWATER_SACRIFICE = new RuntimeScenarioMetadata(
        "underwater-sacrifice",
        Map.of(
            "appTitle", "펠라지아-9 탈출 협상",
            "npcListTitle", "지금 말 걸 사람",
            "npcListSubtitle", "누구를 움직일지 먼저 고르고, 그 입에서 다른 사람 이름이 나오게 만들어라.",
            "interactionTitle", "한 턴 시작하기",
            "interactionSubtitle", "한 사람을 설득해 다른 누군가를 더 위험하게 만들거나, 자신에게 몰린 시선을 흩뜨린다.",
            "interactionPlaceholder", "예: 마지막 중단 결정을 미룬 쪽이 누구였는지부터 다시 짚어봅시다.",
            "boardTitle", "현재 가장 위험한 사람",
            "boardSubtitle", "지금 방 안에서 가장 많이 몰리고 있는 사람부터 읽어라."
        ),
        List.of(
            Map.of(
                "id", "make_case",
                "label", "논리 제시",
                "description", "대상이 왜 가장 남아야 하는 사람인지 논리로 몰아간다.",
                "requiresTarget", true
            ),
            Map.of(
                "id", "expose",
                "label", "폭로",
                "description", "기록, 결정, 숨겨진 책임을 꺼내 대상의 압력을 높인다.",
                "requiresTarget", true
            ),
            Map.of(
                "id", "appeal",
                "label", "감정 호소",
                "description", "죄책감, 연민, 의무감을 자극한다. 대상이 있으면 그 사람을 감싸거나 흔든다.",
                "requiresTarget", false
            ),
            Map.of(
                "id", "ally",
                "label", "연대 제안",
                "description", "지금 말 걸고 있는 인물과 공동전선을 만들고 타깃을 고립시킨다.",
                "requiresTarget", true
            ),
            Map.of(
                "id", "deflect",
                "label", "책임 전가",
                "description", "당신에게 온 책임과 의심을 다른 사람 쪽으로 돌린다.",
                "requiresTarget", true
            ),
            Map.of(
                "id", "stall",
                "label", "시간 끌기",
                "description", "판단을 미루고 다음 라운드까지 버틴다.",
                "requiresTarget", false
            ),
            Map.of(
                "id", "confess",
                "label", "부분 자백",
                "description", "작은 잘못을 먼저 인정해 더 큰 불신을 막는다.",
                "requiresTarget", false
            )
        )
    );

    private final ObjectMapper objectMapper;

    public RuntimeScenarioCatalog(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public RuntimeScenarioMetadata getById(String scenarioId) {
        if (UNDERWATER_SACRIFICE.id().equals(scenarioId)) {
            return UNDERWATER_SACRIFICE;
        }

        throw new RuntimeApiException(
            org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
            "Unsupported runtime scenario: " + scenarioId
        );
    }

    public JsonNode presentationNode(RuntimeScenarioMetadata metadata) {
        return objectMapper.valueToTree(metadata.presentation());
    }

    public JsonNode actionsNode(RuntimeScenarioMetadata metadata) {
        return objectMapper.valueToTree(metadata.availableActions());
    }

    public record RuntimeScenarioMetadata(
        String id,
        Map<String, Object> presentation,
        List<Map<String, Object>> availableActions
    ) {}
}
