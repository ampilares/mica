# Plan: Plugin Marketplace & Monetization

**Version:** 0.1
**Date:** 2026-07-07
**Status:** Draft for review
**Sources:** [PRD.md](PRD.md) (§9.2 Plugin API, NFR-SEC-005, open question 9), [implementation.md](implementation.md) (Phase 7)

---

## 1. Strategy

Mica's core promise is **local-first, file-native, no lock-in**. The app itself
should stay free (or free-core) forever — charging for the editor would fight
the trust promise that drives adoption. The monetization surface is the
**ecosystem**: a plugin marketplace where third-party developers sell paid
plugins and Mica takes a revenue share, plus first-party paid plugins built by
us on the same rails.

Why this model fits Mica:

- **Alignment.** Obsidian proved that a free local-first core grows a passionate
  community; its gap is that community plugins are unpaid, so plugin quality and
  maintenance are volunteer-bound. A marketplace with real payouts attracts
  professional developers and keeps plugins maintained.
- **Compounding moat.** Files are portable by design (that's the promise), so
  the durable moat is not data lock-in but ecosystem value — the workflows users
  assemble from plugins.
- **Revenue mix.** Marketplace take rate (scales with ecosystem) + first-party
  premium plugins (immediate revenue, e.g. encrypted sync, publish, AI
  assistant — all already on the PRD's post-MVP list and all natural paid
  plugins rather than core features).

**Non-negotiable constraints inherited from the product:**

1. The core app never requires an account or network access. The marketplace is
   strictly opt-in; everything degrades gracefully offline.
2. A malicious plugin must not be able to silently exfiltrate or destroy a
   vault. NFR-SEC-005 (sandboxing) gates *any* third-party code, and therefore
   gates the whole marketplace.
3. Purchased plugins must keep working offline and survive our servers
   disappearing (offline-verifiable licenses, no phone-home DRM).

---

## 2. Business model

| Stream | Mechanics | Timing |
|---|---|---|
| **Marketplace take rate** | 15% of paid-plugin revenue, **flat for all listings** (85/15 developer split — undercut app stores' 30%, match the "developer-friendly" positioning; no discounted tiers) | Phase M3 |
| **First-party paid plugins** | Sync (E2E encrypted), Publish (vault → website), AI assistant, Git Pro. Sold through the same marketplace rails at full margin, each priced individually | Phase M2+ |
| **Team/enterprise licensing** | Volume seats for paid plugins, private plugin registries for orgs, SSO for license management | Phase M4+ |

A subscription bundle of first-party plugins ("Mica Pro") was considered and
**deferred** — individual plugin pricing only until the first-party lineup is
big enough for a bundle to mean something.

Pricing mechanics for developers: one-time purchase, subscription, and
free-trial (time-boxed, offline-tolerant) — developer chooses. Free plugins are
always allowed and are the ecosystem's on-ramp (Obsidian-style community
catalog), listed in the same store. **Free-catalog listings must be
source-available** (public repo link, reproducible build verified at review) —
unpaid closed-source binaries are not accepted; paid plugins may be
closed-source.

**Merchant of record:** use Paddle or Lemon Squeezy rather than raw Stripe for
v1 — they handle global sales tax/VAT, which is otherwise a company-killing
compliance burden at marketplace scale. Migrate to Stripe Connect (developers
as connected accounts) only if MoR fees become material.

---

## 3. Plugin platform (the prerequisite)

The marketplace is only as good as the plugin API. This is the answer to PRD
open question 9.

### 3.1 Sandbox model — decision

**Recommendation: sandboxed-webview JS plugins with capability-scoped RPC**, in
two tiers:

- **Tier 1 — UI plugins (JS/TS).** Each plugin runs in an isolated hidden
  `<iframe sandbox>` (separate origin, no Tauri IPC access). All capability
  access goes through a `postMessage` RPC bridge into the host, which forwards
  only granted, namespaced calls to the Rust core. UI contributions (panels,
  commands, block renderers) render through host-controlled mount points.
  This is the Figma model; it fits because our frontend is already a webview
  and plugin authors overwhelmingly know JS.
- **Tier 2 — headless plugins (WASM, later).** `wasmtime`-hosted WASM for
  compute-heavy or backend extensions (importers, exporters, custom database
  property types) with WASI capabilities off by default. Deferred until Tier 1
  proves the market; the manifest format reserves space for it.

Rejected: running plugin JS in the main webview realm (Obsidian's model — full
DOM + `require` access; unacceptable against NFR-SEC-005) and Node/Deno
subprocess plugins (process-level sandboxing per-OS is heavy and porous).

### 3.2 Capability model

The manifest declares permissions; the app enforces them in the **Rust core**
(the webview side is treated as compromised by design):

```json
{
  "id": "com.example.word-count-pro",
  "name": "Word Count Pro",
  "version": "1.2.0",
  "api_version": "1.x",
  "entry": "main.js",
  "permissions": {
    "vault.read": { "scope": ["notes/**.md"] },
    "vault.write": false,
    "network": [],
    "clipboard": false,
    "ui": ["status-bar", "right-panel", "command-palette"]
  },
  "pricing": { "model": "one_time", "trial_days": 14 }
}
```

- `vault.read`/`vault.write` are glob-scoped; writes always go through the
  existing atomic pipeline and are journaled per-plugin (one-click revert of
  everything a plugin changed).
- `network` is an explicit host allowlist, surfaced verbatim on the install
  screen ("This plugin talks to api.example.com").
- Permission changes between versions re-prompt on update.

### 3.3 API surface (v1)

Versioned, additive-only within a major version:

- **Workspace:** read/write granted files, watch events, search queries,
  quick-switch integration.
- **UI:** commands (palette), status-bar items, right-panel views, settings
  pages, editor decorations; custom database views and canvas tools in v1.1.
- **Data:** database query/apply on granted `.database.json` files; canvas ops.
- **Lifecycle:** activate/deactivate, per-plugin persisted settings (in
  `.workspace/plugins/<id>/`, never in user content files).

### 3.4 Developer experience

- `mica-plugin` CLI: `create` (TS template), `dev` (hot-reload against a dev
  vault, permission simulator), `package`, `publish`.
- Typed SDK (`@mica/plugin-sdk`) mirroring `api.ts` types.
- 3–4 first-party open-source reference plugins shipped at launch (word count,
  daily notes, a read-only Obsidian-canvas viewer, one paid example with
  license checks) — these double as API dogfooding.

---

## 4. Marketplace infrastructure

### 4.1 Registry & distribution

- **Package:** signed zip (`.micaplugin`) = manifest + bundle + assets +
  detached Ed25519 signature. Registry signs; developer key countersigns.
- **Registry service:** a small API (listing, search, versions, download URLs)
  backed by object storage + CDN. The index is also published as a static
  signed JSON snapshot so the in-app browser works read-only even if the API is
  down, and so self-hosters/enterprises can mirror it.
- **In-app store UI:** browse/search/install/update/uninstall; permission
  review screen at install; update channel per plugin (stable/beta).
- **Kill list:** a signed revocation feed the app checks opportunistically;
  a revoked plugin is disabled (never silently deleted) with an explanation.

### 4.2 Review & trust pipeline

- Automated on submit: manifest/permission lint, bundle static analysis
  (dangerous API scan), license check, size limits, reproducible-build check.
  Free-catalog submissions additionally require a public source repo whose
  build reproduces the submitted bundle.
- Human review for first submission and for permission expansions; fast-lane
  for patch updates that don't change permissions.
- Badges: **Verified developer**, **Open source** (repo link + build
  reproducibility), **Audited** (paid deep review, later).

### 4.3 Payments & licensing

- Checkout via merchant of record (web-based; the app opens the browser —
  also keeps us out of app-store-style IAP obligations on desktop).
- **License = signed JWT-like file** stored in `.workspace/licenses/`:
  plugin id, license id, entitlement (perpetual + version range, or
  subscription + expiry + grace period), machine-count soft limit.
  Verified offline against our public key; subscriptions get a 30-day offline
  grace window. No hard node-locking — trust-first, revoke abusers via the
  kill list instead of punishing everyone.
- Refunds/chargebacks handled by MoR; license revocation flows through the
  registry feed.
- Developer payouts monthly via MoR/Stripe; public dashboard of installs,
  trials, conversions per plugin.

---

## 5. Phasing

Slots after the current Phase 6 work; the plugin API preview aligns with PRD
Phase 3 (public beta), the paid marketplace with 1.0.

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **M0 — Design gate** (~3 wks, overlaps Phase 5) | API RFC + sandbox spike: iframe RPC bridge PoC, perf test (editor latency with 5 active plugins), escape-attempt red-team writeup | Sandbox model signed off against NFR-SEC-005; API RFC reviewed publicly |
| **M1 — Plugin platform preview** (~6–8 wks) | Tier-1 runtime, permission system + journaled writes, SDK + CLI, reference plugins, sideload-only ("developer mode") | 3 reference plugins run sandboxed; editor p95 latency budget holds; external devs can build without our help |
| **M2 — Community catalog** (~5–6 wks) | Registry + CDN, submission pipeline + automated review, in-app store (free plugins only), kill list, first-party paid plugin built but sold via simple web checkout as a pilot | 20+ community plugins at public-beta launch; install/update/revoke round-trip verified |
| **M3 — Paid marketplace** (~6–8 wks) | MoR integration, offline license format, trials/subscriptions, developer payouts + dashboard, permission-diff re-prompts | First 10 paid plugins live; a purchase works end-to-end offline-after-install; chargeback → revocation flow tested |
| **M4 — Growth** (ongoing) | Team licensing, private registries, Audited badge program, Obsidian-plugin migration shims (PRD §9.2) if feasible; revisit a first-party bundle once ≥4 first-party plugins exist | Take-rate revenue covers marketplace infra cost; NPS of plugin devs tracked |

Team assumption: 1–2 engineers + contracted security review at M0 and M3.
Marketplace backend is deliberately boring (static-index-first, CDN-heavy) to
keep ops cost near zero until revenue justifies more.

---

## 6. Success metrics

- **Ecosystem:** published plugins, active developers, % plugins updated in
  last 90 days.
- **Adoption:** % of active users with ≥1 plugin; installs per user.
- **Revenue:** GMV, take-rate revenue, first-party plugin revenue, trial→paid
  conversion.
- **Trust:** zero sandbox escapes in the wild; time-to-revoke for malicious
  plugins < 24 h; plugin-attributed data-loss incidents = 0 (journaled writes).

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Sandbox escape → vault exfiltration; one incident poisons the trust brand | Critical | Rust-side enforcement, red-team gate at M0 and M3, bug bounty, journaled writes, kill list |
| Ecosystem cold start — no devs without users, no users without plugins | High | Free catalog first (M2), first-party plugins as anchor tenants, 85/15 split, launch fund/bounties for the top-20 requested plugins |
| Paid marketplace before product-market fit wastes runway | High | M0–M1 overlap Phase 5/beta; M3 only starts once beta retention is healthy |
| Obsidian ships paid marketplace first | Medium | Differentiator is *sandboxed* + *paid* + *file-native*; their unsandboxed model is hard to retrofit — move deliberately, not fearfully |
| Tax/compliance burden of global sales | High | Merchant of record from day one |
| API churn burns developer goodwill | Medium | Additive-only v1, deprecation policy ≥ 2 minor versions, plugin CI compat suite we run against upcoming releases |
| Sandboxed API too weak for interesting plugins | Medium | Capability requests reviewed case-by-case can extend the API; measure "plugin ideas blocked by missing API" during M1 preview |

---

## 8. Decisions & open questions

**Decided (2026-07-07):**

1. Take rate is **15% flat** for all paid listings — no open-source discount.
2. **Free-catalog listings must be source-available** (public repo +
   reproducible build); paid plugins may be closed-source.
3. **No Mica Pro bundle for now** — first-party plugins are priced
   individually; revisit once the first-party lineup reaches ~4 plugins.

**Still open:**

1. Do we want org/private registries early (enterprise pull exists) or defer
   past M4?
2. Brand/legal: marketplace developer agreement, DMCA process, and export
   compliance need counsel before M2 opens submissions.
