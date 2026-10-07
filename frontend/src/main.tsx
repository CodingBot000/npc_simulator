// Loading application CSS through a dynamic import keeps it out of the initial
// HTML's render-blocking resources. The inline skeleton remains visible while
// Vite loads the application and its styles together.
void import("./render-app").catch((error: unknown) => {
  console.error("Failed to load the application.", error);

  const loading = document.querySelector<HTMLElement>(".app-loading");
  if (!loading) {
    return;
  }

  loading.classList.add("app-loading--failed");
  loading.setAttribute("aria-busy", "false");
  loading.setAttribute("aria-label", "화면을 불러오지 못했습니다");

  const heading = loading.querySelector("h1");
  if (heading) {
    heading.textContent = "화면을 불러오지 못했습니다";
  }

  const status = loading.querySelector('[role="status"]');
  if (status) {
    status.textContent = "연결 상태를 확인하고 다시 불러와 주세요.";
  }

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "app-loading__retry";
  retry.textContent = "다시 불러오기";
  retry.addEventListener("click", () => window.location.reload());
  loading.querySelector(".app-loading__intro")?.append(retry);
});
