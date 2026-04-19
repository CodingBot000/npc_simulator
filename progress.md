Original prompt: 현재 코드 구조가 바뀟었다.

2026-04-15
- User requested moving the three lower info cards that only appeared in the `세부 열기` popup into the always-visible `현재 상황` section under `frontend/src`.
- Initially added the modal-only `DetailSections` block directly into the main `NpcCard` body.
- Found that this was the wrong fit for the narrow right-column card: `DetailSections` is a modal-oriented 3-column layout with a fixed 300px aside.
- Replaced the inline usage with `InlineDetailCards`, a stacked 3-card layout that shows the same information in the main `현재 상황` panel while keeping the original modal layout unchanged.
- `frontend` lint check passed for `src/components/npc/npc-card.tsx`.
- Local dev verification is partially blocked because the frontend expects an API at `NEXT_PUBLIC_API_BASE_URL` / `http://localhost:8080`, and `/api/world` was 404 in the current local run.
