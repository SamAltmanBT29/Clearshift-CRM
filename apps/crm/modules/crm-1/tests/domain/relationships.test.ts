import { describe, expect, it } from "vitest";
import {
  assertLeadStatusTransition,
  CRM1_LEAD_STATUS_TRANSITIONS,
  isLeadStatusTransitionAllowed
} from "../../src/domain/relationships.js";

const statuses = ["New", "Working", "Qualified", "Closed"] as const;

describe("CRM-1 lead relationships and workflow", () => {
  it.each([
    ["New", "Working"],
    ["Working", "Qualified"],
    ["Qualified", "Closed"]
  ] as const)("allows the forward transition %s -> %s", (current, next) => {
    expect(isLeadStatusTransitionAllowed(current, next)).toBe(true);
    expect(() => assertLeadStatusTransition(current, next)).not.toThrow();
  });

  it.each(statuses)("allows an unchanged %s status as an idempotent update", (status) => {
    expect(isLeadStatusTransitionAllowed(status, status)).toBe(true);
    expect(() => assertLeadStatusTransition(status, status)).not.toThrow();
  });

  it.each(
    statuses.flatMap((current) =>
      statuses
        .filter((next) =>
          next !== current && !CRM1_LEAD_STATUS_TRANSITIONS[current].includes(next)
        )
        .map((next) => [current, next] as const)
    )
  )("rejects the forbidden transition %s -> %s with a stable error", (current, next) => {
    expect(isLeadStatusTransitionAllowed(current, next)).toBe(false);
    let error: unknown;
    try {
      assertLeadStatusTransition(current, next);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "INVALID_LEAD_STATUS_TRANSITION",
      statusCode: 422
    });
  });
});
