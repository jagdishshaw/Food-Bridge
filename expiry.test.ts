import { describe, expect, it } from "vitest";
import {
  getCountdownInfo,
  getEffectiveStatus,
  isListingExpired,
  validateSafeWindow,
} from "@/lib/domain/expiry";
import { createListingSchema } from "@/lib/validation";

describe("Food safety 6-hour limit and auto-expiry logic", () => {
  it("accepts a valid safe-until window within 6 hours", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const preparedAt = "2026-11-25T09:00:00Z";
    const safeUntil = "2026-11-25T14:30:00Z";

    const res = validateSafeWindow(preparedAt, safeUntil, now, 6);
    expect(res.ok).toBe(true);
  });

  it("rejects listings where safe_until exceeds 6 hours from prepared_at", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const preparedAt = "2026-11-25T09:00:00Z";
    const safeUntil = "2026-11-25T16:00:00Z"; // 7 hours

    const res = validateSafeWindow(preparedAt, safeUntil, now, 6);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("6 hours");
  });

  it("rejects listings already past safe_until", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const preparedAt = "2026-11-25T08:00:00Z";
    const safeUntil = "2026-11-25T11:30:00Z";

    const res = validateSafeWindow(preparedAt, safeUntil, now, 6);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("future");
  });

  it("transitions available listings past safe_until to expired", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(isListingExpired("available", "2026-11-25T11:59:00Z", now)).toBe(true);
    expect(getEffectiveStatus("available", "2026-11-25T11:59:00Z", now)).toBe(
      "expired"
    );
    expect(getEffectiveStatus("available", "2026-11-25T13:00:00Z", now)).toBe(
      "available"
    );
    expect(getEffectiveStatus("collected", "2026-11-25T10:00:00Z", now)).toBe(
      "collected"
    );
  });

  it("formats countdown labels and urgency levels", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(getCountdownInfo("2026-11-25T09:59:00Z", now)).toMatchObject({
      expired: true,
      label: "Expired",
    });
    expect(getCountdownInfo("2026-11-25T10:20:00Z", now)).toMatchObject({
      expired: false,
      urgency: "critical",
    });
    expect(getCountdownInfo("2026-11-25T11:00:00Z", now)).toMatchObject({
      expired: false,
      urgency: "warning",
    });
    expect(getCountdownInfo("2026-11-25T13:00:00Z", now)).toMatchObject({
      expired: false,
      urgency: "normal",
    });
  });

  it("rejects listing creation if food safety checklist items are unticked", () => {
    const now = Date.now();
    const res = createListingSchema.safeParse({
      title: "Hostel Dal Rice",
      foodType: "cooked_meals",
      vegFlag: true,
      quantity: 15,
      unit: "kg",
      preparedAt: new Date(now - 30 * 60_000).toISOString(),
      safeUntil: new Date(now + 3 * 3_600_000).toISOString(),
      pickupAddress: "Koramangala 4th Block, Bengaluru",
      lat: 12.9352,
      lng: 77.6245,
      pickupWindowStart: new Date(now).toISOString(),
      pickupWindowEnd: new Date(now + 2 * 3_600_000).toISOString(),
      safetyHygienic: true,
      safetyCovered: false,
      safetyNotServed: true,
    });

    expect(res.success).toBe(false);
  });
});
