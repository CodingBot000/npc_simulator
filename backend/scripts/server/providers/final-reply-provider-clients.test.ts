import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunpodLoadBalancerPreflightTimeout } from "./final-reply-provider-clients";

test("RunPod preflight can use the full configured cold-start budget", () => {
  assert.equal(
    resolveRunpodLoadBalancerPreflightTimeout({
      remainingMs: 180_000,
      configuredTimeoutMs: 90_000,
    }),
    90_000,
  );
});

test("RunPod preflight preserves a minimum generation budget", () => {
  assert.equal(
    resolveRunpodLoadBalancerPreflightTimeout({
      remainingMs: 30_000,
      configuredTimeoutMs: 90_000,
    }),
    15_000,
  );
});

test("RunPod preflight never returns a sub-second timeout", () => {
  assert.equal(
    resolveRunpodLoadBalancerPreflightTimeout({
      remainingMs: 5_000,
      configuredTimeoutMs: 90_000,
    }),
    1_000,
  );
});
