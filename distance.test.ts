import { describe, expect, it } from "vitest";
import {
  filterAndSortByDistance,
  haversineKm,
} from "@/lib/domain/distance";

describe("Haversine distance & NGO feed radius filtering", () => {
  const koramangala = { lat: 12.9352, lng: 77.6245 };
  const indiranagar = { lat: 12.9784, lng: 77.6408 };
  const whitefield = { lat: 12.9698, lng: 77.7499 };

  it("computes 0 km for identical coordinates", () => {
    expect(
      haversineKm(koramangala.lat, koramangala.lng, koramangala.lat, koramangala.lng)
    ).toBe(0);
  });

  it("computes realistic city distances in Bengaluru", () => {
    const koraToIndira = haversineKm(
      koramangala.lat,
      koramangala.lng,
      indiranagar.lat,
      indiranagar.lng
    );
    const koraToWhitefield = haversineKm(
      koramangala.lat,
      koramangala.lng,
      whitefield.lat,
      whitefield.lng
    );

    expect(koraToIndira).toBeGreaterThan(4);
    expect(koraToIndira).toBeLessThan(7);
    expect(koraToWhitefield).toBeGreaterThan(12);
    expect(koraToWhitefield).toBeLessThan(18);
  });

  it("filters listings by radius (2/5/10/25 km) and sorts correctly", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const listings = [
      {
        id: "near-later",
        lat: 12.9385,
        lng: 77.6192, // ~0.7 km from Koramangala
        safeUntil: "2026-11-25T15:00:00Z",
      },
      {
        id: "mid-urgent",
        lat: indiranagar.lat,
        lng: indiranagar.lng, // ~5.1 km
        safeUntil: "2026-11-25T10:45:00Z",
      },
      {
        id: "far-whitefield",
        lat: whitefield.lat,
        lng: whitefield.lng, // ~14.1 km
        safeUntil: "2026-11-25T12:00:00Z",
      },
    ];

    const within2Km = filterAndSortByDistance(
      listings,
      koramangala.lat,
      koramangala.lng,
      2,
      "distance",
      now
    );
    expect(within2Km.map((l) => l.id)).toEqual(["near-later"]);

    const within10KmByDistance = filterAndSortByDistance(
      listings,
      koramangala.lat,
      koramangala.lng,
      10,
      "distance",
      now
    );
    expect(within10KmByDistance.map((l) => l.id)).toEqual([
      "near-later",
      "mid-urgent",
    ]);

    const within25KmByUrgency = filterAndSortByDistance(
      listings,
      koramangala.lat,
      koramangala.lng,
      25,
      "urgency",
      now
    );
    expect(within25KmByUrgency.map((l) => l.id)).toEqual([
      "mid-urgent",
      "far-whitefield",
      "near-later",
    ]);
  });
});
