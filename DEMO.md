# FoodBridge — 2-Minute Demo Script & Test Accounts

## Seeded Test Accounts (Bengaluru Pilot)

All demo accounts share the password: **`Password123!`**

| Role | Organization | Email | Status |
| :--- | :--- | :--- | :--- |
| **Donor** | Annapoorna Grand Caterers (Koramangala) | `donor1@foodbridge.in` | Verified |
| **Donor** | Campus Central Hostel Mess (Malleswaram) | `donor2@foodbridge.in` | Verified |
| **Donor** | Royal Orchid Wedding Hall (Indiranagar) | `donor3@foodbridge.in` | Verified |
| **NGO (Verified)** | Akshaya Hope Foundation (Koramangala) | `ngo1@foodbridge.in` | Verified |
| **NGO (Verified)** | Bengaluru Night Shelter Trust (MG Road) | `ngo2@foodbridge.in` | Verified |
| **NGO (Pending)** | Sunrise Outreach Collective (Whitefield) | `ngo5@foodbridge.in` | Pending Admin Approval |
| **Admin** | FoodBridge Pilot Ops | `admin@foodbridge.in` | Admin |

---

## 2-Minute Live Demo Script

### 0:00 – 0:20 — Landing Page & Public Impact
1. Open **http://localhost:3000**.
2. Highlight the value proposition ("Post in under 60 seconds") and the live impact snapshot card.
3. Click **Live Impact** (`/impact`) to show total kg redirected, estimated meals (`0.4 kg/meal`), CO2 avoided, and the weekly Recharts bar chart.

### 0:20 – 0:55 — Donor Posts Surplus Food (< 60s)
1. Click **Sign in** (`/login`) and click the **Donor (Annapoorna Caterers)** demo button.
2. Click **Post Surplus Food** (`/donor/new`).
3. Enter `"Event Veg Biryani & Raita"`, `25 kg`, confirm the **3-point food safety checklist**, and optionally point out the **6-hour max safety rule**.
4. Click **Publish Surplus Listing** and show it live on `/donor` with its countdown timer.

### 0:55 – 1:35 — Verified NGO Discovers, Maps & Claims
1. Click **Sign out**, then click **Verified NGO (Akshaya Hope)** on `/login`.
2. Show `/ngo`: demonstrate the **Radius filter (`2 / 5 / 10 / 25 km`)**, **Veg Only** toggle, and the **Leaflet + OpenStreetMap** pins.
3. Click **Claim Pickup** on the new listing. Point out that it locks atomically (a second NGO cannot double-claim) and notifies the donor.
4. On **My Claims**, click **Mark Collected**, enter `24` kg actual weight, and confirm.

### 1:35 – 2:00 — Admin Verification & Email Audit Log
1. Sign out and sign in as **Admin (Pilot Ops)** (`admin@foodbridge.in`).
2. On `/admin`, show **Sunrise Outreach Collective** (`ngo5@foodbridge.in`) at the top as `Pending` and click **Approve** to unlock their claiming ability.
3. Switch to **Email Log** to show the automated notification records created during posting, claiming, and collection, then revisit `/impact` to show the updated totals.
