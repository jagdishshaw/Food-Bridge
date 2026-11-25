import { createClient } from "@supabase/supabase-js";
import { getLocalDb, reseedDatabase } from "../src/lib/backend/local/db";
import { buildSeedDataset } from "../src/lib/seed-data";

async function seedSupabase(url: string, serviceKey: string) {
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { users, listings, reports } = buildSeedDataset(new Date());
  const idByEmail = new Map<string, string>();

  for (const u of users) {
    const { data: existingList } = await supabase.auth.admin.listUsers();
    const found = existingList?.users.find(
      (item) => item.email?.toLowerCase() === u.email.toLowerCase()
    );

    let uid = found?.id;
    if (!uid) {
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { role: u.role, org_name: u.orgName },
      });
      if (error || !created.user) {
        throw new Error(`Failed to create Supabase user ${u.email}: ${error?.message}`);
      }
      uid = created.user.id;
    }

    idByEmail.set(u.email, uid);
    await supabase.from("profiles").upsert({
      id: uid,
      email: u.email.toLowerCase(),
      role: u.role,
      org_name: u.orgName,
      contact_name: u.contactName,
      phone: u.phone,
      address: u.address,
      lat: u.lat,
      lng: u.lng,
      verified: u.verified,
    });
  }

  const mapUserId = (seedId: string | null) => {
    if (!seedId) return null;
    const seedUser = users.find((u) => u.id === seedId);
    return seedUser ? (idByEmail.get(seedUser.email) ?? seedId) : seedId;
  };

  for (const l of listings) {
    await supabase.from("listings").upsert({
      id: l.id,
      donor_id: mapUserId(l.donorId),
      title: l.title,
      food_type: l.foodType,
      veg_flag: l.vegFlag,
      quantity: l.quantity,
      unit: l.unit,
      quantity_kg: l.quantityKg,
      prepared_at: l.preparedAt,
      safe_until: l.safeUntil,
      pickup_address: l.pickupAddress,
      lat: l.lat,
      lng: l.lng,
      pickup_window_start: l.pickupWindowStart,
      pickup_window_end: l.pickupWindowEnd,
      photo_url: l.photoUrl,
      notes: l.notes,
      safety_hygienic: true,
      safety_covered: true,
      safety_not_served: true,
      status: l.status,
      claimed_by: mapUserId(l.claimedBy),
      claimed_at: l.claimedAt,
      collected_at: l.collectedAt,
      collected_by: mapUserId(l.collectedBy),
      actual_quantity: l.actualQuantity,
    });
  }

  for (const r of reports) {
    await supabase.from("reports").upsert({
      id: r.id,
      listing_id: r.listingId,
      reporter_id: mapUserId(r.reporterId),
      rating: r.rating,
      reason: r.reason,
      details: r.details,
      resolved: r.resolved,
    });
  }

  console.log(
    `Seeded Supabase (${users.length} users, ${listings.length} listings, ${reports.length} reports).`
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (url && serviceKey) {
    await seedSupabase(url, serviceKey);
    return;
  }

  const db = getLocalDb();
  reseedDatabase(db);
  console.log(
    "Seeded Local SQLite database with 1 admin, 5 donors, 5 NGOs, 20 listings, and 2 reports (Bengaluru, India)."
  );
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
