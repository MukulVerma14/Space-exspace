# ADR 012: Plain-Text Natural Key QR Code Payload vs URL, and Error Correction Level H

## Status
Accepted

## Context
SPACE EXSPACE manages and tracks heavy construction and industrial plant equipment (all-terrain cranes, diesel power generators, high-pressure air compressors, and excavators) across central fabrication workshops, laydown yards, and remote desert worksites throughout Saudi Arabia's Eastern Province.

Physical asset tags (adhesive vinyl, engraved phenolic plates, or weather-resistant aluminium labels) are affixed directly to machine chassis, booms, and enclosures. Field technicians and yard operators use mobile devices and web cameras to scan these physical tags during equipment check-ins, inter-yard transfers, maintenance intake, and rental handovers.

When designing the QR generation engine (`GET /api/labels/sheet`), two foundational architectural decisions were required:
1. **QR Payload Format**: Should the QR code encode a full HTTP URL (e.g., `https://app.spaceexspace.com/equipment/CRN-50-001`) or solely the plain natural business key (`CRN-50-001`)?
2. **QR Error Correction Level**: Which Reed-Solomon error correction level (L: ~7%, M: ~15%, Q: ~25%, or H: ~30%) should be standardized for all label generation?
3. **Data Exposure on Physical Labels**: What data attributes are permitted on printable label sheets?

---

## Decisions

### 1. QR Payload Encodes Strictly the Plain Natural Key (`asset_code`)
The physical QR code matrix encodes **only** the plain `asset_code` string (e.g., `CRN-50-001`), completely devoid of any protocol, hostname, port, or URI path prefixes.

#### Rationale:
- **Domain Immortality**: Affixing a URL to physical steel machinery permanently couples every printed sticker to a specific DNS domain name and web routing topology. If the company rebrands, renames its domain (e.g. from `.com` to `.sa`), shifts to a private corporate intranet, reconfigures behind a secure enterprise reverse proxy, or migrates between cloud hosting environments, **every previously printed sticker on hundreds of machines across industrial sites becomes immediately dead**. In contrast, a plain business identifier (`CRN-50-001`) remains permanent and valid across decades of IT infrastructure migrations.
- **Protocol & Network Independence**: In remote desert areas where internet connectivity is intermittent or non-existent, field staff run offline-first progressive web applications. An in-app camera scanner reads raw barcode text directly; when it decodes `CRN-50-001`, the application looks up the local cache or outbox queue without making an HTTP redirect or triggering unintended browser URL navigation.
- **Universal Scanner Compatibility**: Plain text strings are recognized natively by all industrial handheld barcode scanners, warehouse terminals, and generic smartphone cameras without triggering unwanted external browser launches.

### 2. Error Correction Standardized at Level H (~30% Recovery)
All generated QR codes are generated using ISO/IEC 18004 Error Correction Level **H** (High).

#### Rationale:
- **Industrial Environment Harshness**: Construction equipment operates in punishing environments characterized by abrasive desert sandstorms, intense UV sun degradation, engine oil splatter, grease, pressure washing, and physical paint scratches.
- **Reed-Solomon Resilience**: Error correction level H reserves approximately 30% of the QR matrix for Reed-Solomon error correction codewords. This guarantees that even if nearly a third of the physical sticker is torn off, covered in dried mud, or gouged by crane rigging cables, the scanner can reconstruct 100% of the original `asset_code` without failing.

### 3. Strict Invariant: Zero Financial or Commercial Data on Physical Labels
Printable sheets generated via `GET /api/labels/sheet` contain exclusively operational tracking information:
- Asset Code (rendered in large monospace typography for immediate human distance-reading).
- Manufacturer & Model (`make` + `model`).
- Equipment Type & Primary Engineering Spec (e.g. `Rough Terrain Crane`, `50 Ton`).
- Serial Number (`serial_no`) and Yard Base Location.

**Financial and commercial terms (client rental rates, replacement costs, book values, VAT, or billing information) are strictly prohibited and never rendered.** Physical labels on field machinery are visible to subcontractors, third-party drivers, and competing crane operators; leaking proprietary commercial rate cards or equipment acquisition valuations onto physical tags would severely compromise company commercial negotiation posture.

### 4. Hard Cap on Printable Sheet Requests
The endpoint enforces a strict hard cap of **50 labels per request** (e.g., via `assetCodes` list or filtered query):
- **Resource Protection**: Generating high-resolution QR bitmaps server-side is CPU- and memory-intensive. Unbounded generation queries could exhaust Node.js event loop capacity or cause out-of-memory crashes.
- **Physical Layout Alignment**: 50 labels correspond to approximately 6 full A4 grid sheets (arranged in 2-column label grids), which represents the maximum typical batch print run for a yard tagging session.

---

## Alternatives Considered & Rejected

1. **Encoding Deep-Link URLs in QR Code (`https://app.spaceexspace.com/scan/CRN-50-001`)**:
   - *Rejected*: Permanently couples physical equipment tags to DNS domain names and routing topologies. Any future domain transition, routing restructure, or intranet re-architecture would require manually replacing hundreds of weather-resistant stickers across active refinery sites.
2. **Error Correction Level L (~7%) or M (~15%)**:
   - *Rejected*: While lower error correction produces smaller QR matrices with fewer modules, they fail catastrophically in dirty construction yards. A single scratch or splash of hydraulic fluid renders Level L labels completely unscannable.
3. **Surrogate Database Integer ID in QR Code (`42`)**:
   - *Rejected*: Database integer primary keys carry zero meaning to human mechanics inspecting a machine in the yard, and become invalid if databases are restored, merged, or re-indexed. Natural business codes (`CRN-50-001`) are globally unique and human-readable.
4. **Displaying Equipment Replacement Value or Daily Rate on Labels**:
   - *Rejected*: Leaks confidential business terms to external jobsite personnel, client procurement agents, and competing subcontractors.

---

## Consequences & Verification
- Mobile and web scanning interfaces process raw scanned strings directly as `asset_code`.
- `GET /api/labels/sheet` returns a standards-compliant A4 HTML grid printable directly from the browser print dialog or programmatic PDF generators.
- Automated tests (`backend/src/__tests__/labels.test.ts`) decode generated QR image buffers back to the exact plain `asset_code`, verify HTTP 404 for unknown codes, verify the 50-label hard cap, and assert zero financial keywords anywhere in response outputs.
