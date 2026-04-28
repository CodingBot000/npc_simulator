Original prompt: 현재 코드 구조가 바뀟었다.

2026-04-15
- User requested moving the three lower info cards that only appeared in the `세부 열기` popup into the always-visible `현재 상황` section under `frontend/src`.
- Initially added the modal-only `DetailSections` block directly into the main `NpcCard` body.
- Found that this was the wrong fit for the narrow right-column card: `DetailSections` is a modal-oriented 3-column layout with a fixed 300px aside.
- Replaced the inline usage with `InlineDetailCards`, a stacked 3-card layout that shows the same information in the main `현재 상황` panel while keeping the original modal layout unchanged.
- `frontend` lint check passed for `src/components/npc/npc-card.tsx`.
- Local dev verification was partially blocked because the frontend needed a reachable backend API base URL. Current frontend 기준 변수는 `VITE_API_BASE_URL` 또는 runtime `env-config.js`이며, 당시 로컬 실행에서는 `/api/world`가 404였다.
