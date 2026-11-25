import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeLocalDb } from "@/lib/backend/local/db";
import { LocalFoodBridgeBackend } from "@/lib/backend/local/repository";
import { AppError } from "@/lib/backend/errors";

describe("Atomic claim logic, race conditions, cancel & collection", () => {
  let tempDir: string;
  let backend: LocalFoodBridgeBackend;

  const donorId = "20000000-0000-4000-8000-000000000001";
  const verifiedNgo1 = "30000000-0000-4000-8000-000000000001";
  const verifiedNgo2 = "30000000-0000-4000-8000-000000000002";
  const pendingNgo = "30000000-0000-4000-8000-000000000005";

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "foodbridge-test-"));
    process.env.FOODBRIDGE_SQLITE_PATH = path.join(tempDir, "test.db");
    backend = new LocalFoodBridgeBackend();
  });

  afterAll(() => {
    closeLocalDb();
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.FOODBRIDGE_SQLITE_PATH;
  });

  it("allows exactly ONE winner when two verified NGOs claim concurrently", async () => {
    const now = Date.now();
    const created = await backend.createListing(donorId, {
      title: "Race Condition Test Biryani",
      foodType: "cooked_meals",
      vegFlag: true,
      quantity: 25,
      unit: "kg",
      preparedAt: new Date(now - 20 * 60_000).toISOString(),
      safeUntil: new Date(now + 3 * 3_600_000).toISOString(),
      pickupAddress: "Koramangala, Bengaluru",
      lat: 12.9352,
      lng: 77.6245,
      pickupWindowStart: new Date(now).toISOString(),
      pickupWindowEnd: new Date(now + 2 * 3_600_000).toISOString(),
      photoUrl: null,
      notes: null,
      safetyHygienic: true,
      safetyCovered: true,
      safetyNotServed: true,
    });

    const results = await Promise.allSettled([
      backend.claimListing(created.id, verifiedNgo1),
      backend.claimListing(created.id, verifiedNgo2),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserReason).toBeInstanceOf(AppError);
    expect((loserReason as AppError).status).toBe(409);
  });

  it("blocks unverified NGOs from claiming", async () => {
    const availableListingId = "40000000-0000-4000-8000-000000000001";
    await expect(
      backend.claimListing(availableListingId, pendingNgo)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("supports cancelling a claim (returns to available) and confirming collection", async () => {
    const listingId = "40000000-0000-4000-8000-000000000002";

    const claimed = await backend.claimListing(listingId, verifiedNgo1);
    expect(claimed.status).toBe("claimed");
    expect(claimed.claimedBy).toBe(verifiedNgo1);

    const cancelled = await backend.cancelClaim(listingId, verifiedNgo1);
    expect(cancelled.status).toBe("available");
    expect(cancelled.claimedBy).toBeNull();

    const reclaimed = await backend.claimListing(listingId, verifiedNgo2);
    expect(reclaimed.status).toBe("claimed");

    const collected = await backend.confirmCollection(listingId, verifiedNgo2, 110);
    expect(collected.status).toBe("collected");
    expect(collected.actualQuantity).toBe(110);
  });

  it("prevents claiming an expired listing", async () => {
    const expiredListingId = "40000000-0000-4000-8000-000000000018";
    await expect(
      backend.claimListing(expiredListingId, verifiedNgo1)
    ).rejects.toMatchObject({ status: 409 });
  });
});
