export function containsHangul(text: string) {
  return /[가-힣]/u.test(text);
}

export function looksEnglishOnly(text: string) {
  return /[A-Za-z]/u.test(text) && !containsHangul(text);
}

export function extractDelimitedText(output: string) {
  const matches = [...String(output).matchAll(/==========\n([\s\S]*?)\n==========/g)];
  return matches.at(-1)?.[1]?.trim() ?? "";
}

export function normalizeReplyText(text: string) {
  const normalized = text
    .trim()
    .replace(/^(?:npc\s*대사|npc\s*reply|대사|엔지니어|의사|감독관|소장|director|supervisor|doctor|engineer)\s*:\s*/iu, "")
    .trim();
  return stripWrappingQuotes(normalized);
}

export function normalizeInlineText(text: string) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function stripWrappingQuotes(text: string) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return trimmed;
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];

  for (const [open, close] of quotePairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }

  return trimmed;
}

export function compactSentence(text: string) {
  return normalizeInlineText(text).replace(/[.。]$/u, "");
}

export function containsAnyPattern(text: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function truncateForPrompt(text: string, maxLength = 96) {
  const normalized = normalizeInlineText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
