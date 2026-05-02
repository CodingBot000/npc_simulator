const REPLY_LABEL_PREFIX = /^(?:\.\.\.|…|\s)*(?:npc\s*대사|npc\s*reply|대사|의사|감독관|엔지니어|소장|doctor|supervisor|engineer|director)\s*:\s*/iu;
const META_OPENING_PATTERNS = [
  /^(?:\.\.\.|…|\s)*(?:의무실 기록에 따르면|기록에 따르면)[,.: ]*/u,
  /^(?:\.\.\.|…|\s)*(?:판단 기준(?:은|으로는)?|검토하십시오|검토(?:하면|하면요)?)[,.: ]*/u,
  /^(?:\.\.\.|…|\s)*(?:response|reply|assistant)\s*:\s*/iu,
];

export function sanitizeReplyText(text: string) {
  const original = String(text ?? "").trim();
  if (!original) {
    return original;
  }

  let cleaned = original.replace(REPLY_LABEL_PREFIX, "").trim();
  for (const pattern of META_OPENING_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of quotePairs) {
    if (cleaned.startsWith(open) && cleaned.endsWith(close)) {
      cleaned = cleaned.slice(open.length, cleaned.length - close.length).trim();
      break;
    }
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || original;
}
