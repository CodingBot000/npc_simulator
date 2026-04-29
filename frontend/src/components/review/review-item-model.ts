import type {
  PairReviewItemView,
  SftReviewItemView,
} from "@/lib/review-types";

export type ReviewItem = SftReviewItemView | PairReviewItemView;

export const SFT_DECISIONS: Exclude<SftReviewItemView["decision"], null>[] = [
  "include",
  "exclude",
  "escalate",
];

export const PAIR_DECISIONS: Exclude<PairReviewItemView["decision"], null>[] = [
  "include",
  "flip",
  "exclude",
  "escalate",
];

export function isSftItem(item: ReviewItem): item is SftReviewItemView {
  return item.kind === "sft";
}

export function decisionLabel(decision: ReviewItem["decision"]) {
  switch (decision) {
    case "include":
      return "포함";
    case "exclude":
      return "제외";
    case "escalate":
      return "보류";
    case "flip":
      return "뒤집기";
    default:
      return "미정";
  }
}

export function decisionTone(decision: ReviewItem["decision"]) {
  switch (decision) {
    case "include":
      return "bg-[rgba(74,166,124,0.16)] text-[var(--success)]";
    case "exclude":
      return "bg-[rgba(214,90,90,0.16)] text-[var(--danger)]";
    case "flip":
      return "bg-[rgba(209,111,76,0.16)] text-[var(--accent)]";
    case "escalate":
      return "bg-[rgba(76,194,200,0.16)] text-[var(--teal)]";
    default:
      return "bg-white/6 text-[var(--ink-muted)]";
  }
}
