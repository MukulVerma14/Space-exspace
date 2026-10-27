# Open Questions & Client Clarifications

This document tracks ambiguities, unconfirmed brief statements, and open architectural choices for SPACE EXSPACE Company. These items must not be decided silently in code; they must be raised with the client or domain stakeholders.

| # | Topic | Question / Ambiguity | Context / Impact | Status |
|---|---|---|---|---|
| 1 | **Fleet Scale** | Is the equipment fleet ~145 active items or 5,000 items? | The brief mentions 5,000, but local data indicates ~145 items. For 145 items, lightweight indexing and standard SQL views perform in sub-milliseconds. For 5,000+ items with high-concurrency GPS/movement logs, we may need partitioned log tables and materialized views with refresh triggers. | **OPEN** |
| 2 | **Chatbot Scope ("Books")** | What does "books" refer to in the chatbot feature request? | Does "books" mean standard operating equipment manuals/safety PDFs, accounting general ledgers, or historical rental records? | **OPEN** |
| 3 | **Odoo Integration** | Which specific Odoo modules or workflows are referenced? | Are we eventually replacing or integrating with Odoo Inventory, Rental, or Accounting? Determining API hooks vs total replacement affects foreign key naming. | **OPEN** |
| 4 | **Localization & Arabic** | Is Arabic (and RTL UI) required for yard staff? | Most field technicians in Saudi Arabia may prefer or legally require Arabic interfaces. The prototype is English-only; internationalization (i18n) keys will be needed if Arabic is confirmed. | **OPEN** |
| 5 | **VAT Inclusivity** | Are standard rate cards quoted VAT-inclusive or VAT-exclusive? | Saudi VAT is 15%. Invoices store explicit `vat_amount` and `subtotal`, but whether rental quotation rates shown to clients already include VAT affects billing calculations. | **OPEN** |
| 6 | **ZATCA Phase 2** | What are the timeline and integration expectations for ZATCA e-invoicing? | Out of scope for this prototype, but production rollout in Saudi Arabia requires cryptographic stamp generation, XML UBL 2.1 formatting, and QR encoding (TLV format). | **OPEN** |
