const REVIEWER_STORAGE_KEY = "npc-simulator-reviewer";
const REVIEWER_ID_PREFIX = "local-reviewer";

function randomReviewerSuffix() {
  try {
    const bytes = new Uint8Array(2);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  }
}

function createDefaultReviewer() {
  return `${REVIEWER_ID_PREFIX}-${randomReviewerSuffix()}`;
}

export function readStoredReviewer() {
  try {
    const storedReviewer = window.localStorage.getItem(REVIEWER_STORAGE_KEY)?.trim();
    if (storedReviewer) {
      return storedReviewer;
    }

    const generatedReviewer = createDefaultReviewer();
    window.localStorage.setItem(REVIEWER_STORAGE_KEY, generatedReviewer);
    return generatedReviewer;
  } catch {
    return createDefaultReviewer();
  }
}

export function persistReviewer(value: string) {
  try {
    const trimmed = value.trim();
    if (trimmed) {
      window.localStorage.setItem(REVIEWER_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(REVIEWER_STORAGE_KEY);
    }
  } catch {
    return;
  }
}
