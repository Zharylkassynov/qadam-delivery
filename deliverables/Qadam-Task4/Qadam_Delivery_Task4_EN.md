# Qadam Delivery - Task 4

Technological Entrepreneurship | School of Digital Technologies, Narxoz University

Prepared 4 November 2026. Team: Qadam Delivery.


## 01. Quantified Value Proposition

Qadam Delivery | A Telegram-first delivery service for Almaty

Less coordination.
More time for customers.
Target advantage: 600 / 90 = 6.67x; modeled, not observed.

For small Almaty shops with repeat deliveries, Qadam aims to bring order entry, courier handoff, status checks and saved history into one workflow.
### 01 / ENGINEER VALUE
A six-part value canvas, a transparent 6.7x time model and a plan to measure the result.

### 02 / MAP ADOPTION
Five buying roles, practical approval gates, the customer life cycle and system architecture.

### 03 / PREPARE TESTING
Three usability tasks, ten recorded sessions and twenty separate feedback respondents.

**Evidence status:** the advantage is an engineering hypothesis. No Task 4 usability recordings, timing dataset or completed feedback log were supplied. This report provides the testing setup; it does not claim completed validation.


## 02. One beachhead, one measurable job

Business focus narrows initial acquisition; individual customers remain part of Qadam.

### BEACHHEAD CUSTOMER
**Owner-operated flower, gift and small social-commerce shops in Almaty.**

One location; owner or sales administrator coordinates local parcels. Prioritize shops with repeat dispatches, an existing Telegram account and a chat/spreadsheet workflow to compare.

### JOB AND COMPARISON BOUNDARY
**Job:** arrange a routine delivery, answer the buyer and retain a usable completion record.

**Status quo to test:** messaging/calling a known courier and manually recording progress.

The 6.7x model does not compare delivery speed or price against inDrive, Yandex or Wolt.

| Evidence | What can be stated |
| --- | --- |
| Prior research [R2] | The midterm script reports approximately 8-10 courier interviews and registrations. Raw interview logs were not supplied here. |
| Business demand [R2] | Shop demand, willingness to pay and the assumed 40 deliveries/month still require business-side evidence. |
| Product [R1, R3] | Order creation, acceptance, status history and last-known location are documented. Newer functions have separate publication/phone-check gates. |
| Commercial state [R4] | Automatic tariff is disabled; the pilot model pays the courier directly and uses 0% Qadam commission. |
| Task 4 evidence | The 600-second baseline, 90-second target and labor value are assumptions; no measured value advantage is reported. |


## 03. From customer needs to product value

IDs show the proposed fit. All customer priorities and benefit sizes remain hypotheses to test. [R1-R3, R8]

### PRODUCTS / SERVICES
**S1.** Order form, saved shop profile and repeat order.
**S2.** Courier acceptance, status flow and Telegram messages.
**S3.** Server-saved history and timestamped map.

### JOBS TO BE DONE
**J1.** Prepare and dispatch a routine customer parcel.
**J2.** Tell the buyer what has happened to the order.
**J3.** Confirm completion and keep a useful record.

### PAIN RELIEVERS
**R1 / P1.** Reuse pickup and order data to reduce copying.
**R2 / P2.** Link acceptance and progress to one order.
**R3 / P3.** Restore records and disclose old GPS data.

### PAINS
**P1.** Retyping addresses across chat and records.
**P2.** Fragmented confirmations and status enquiries.
**P3.** Lost history or uncertain courier location.

### GAIN CREATORS
**C1 / G1.** Target 90 seconds of active coordination.
**C2 / G2.** One place to answer delivery questions.
**C3 / G3.** Repeat an order from retained history.

### GAINS
**G1.** More staff time available for serving customers.
**G2.** Confidence when responding to the recipient.
**G3.** Less effort on the next dispatch and review.

Scope: shop-facing value. Couriers are service partners; recipients are beneficiaries. Feature readiness is separated on page 12.

## 04. Every proposed benefit has a test

Priority reflects the team hypothesis, rather than a ranked customer survey.

| Need / priority | Product response | Observable acceptance criterion | Test |
| --- | --- | --- | --- |
| P1 / high; Repeated data entry | Saved pickup profile and repeat-order flow. | At least 9/10 users change recipient details and create the intended repeat order without help, within 90 seconds. | T3; p.13 |
| P2 / high; Scattered progress | An order-linked status view and notifications, when enabled. | At least 8/10 users correctly identify current status and the next party responsible. | T2; p.13 |
| P3 / high; Uncertain records / GPS | Server persistence, history and last-location timestamp. | At least 9/10 recover the same order after reopening; at least 8/10 explain that an old point is not live. | T2; p.13 |
| J1 + G1 / high; Coordination effort | Reduce copying, switching and manual completion logging. | Primary measured ratio is at least 5x, with at least 90% successful scenario completion. Include all required active work. | Time study; p.7 |
| G3 / medium; Repeat operations | Reusable order history and optional shop profile. | Observe whether the shop voluntarily makes another dispatch during a separately approved field pilot. | Buying review; p.9 |

**Fit can fail:** a shop may already have an efficient delivery app, prefer WhatsApp, or need guaranteed courier supply. A clearer interface does not establish courier availability, on-time delivery or willingness to pay.


## 05. A 6.7x coordination-time hypothesis

Unit of analysis: active shop-staff time for one routine repeat dispatch, across its life cycle.

| Activity | Chat + manual log | Qadam target | Mechanism |
| --- | --- | --- | --- |
| Prepare repeat order / recipient details | 180 s | 45 s | Reuse saved pickup and a previous order; edit recipient. |
| Confirm courier handoff / acceptance | 120 s | 15 s | Read acceptance linked to the order. |
| Retrieve progress for the buyer | 180 s | 20 s | Open a single order status view. |
| Locate / retain completion record | 120 s | 10 s | Use automatically saved history. |
| TOTAL ACTIVE STAFF TIME | 600 s = 10 min | 90 s = 1.5 min | Every activity time in this table is an estimate. |

Efficiency ratio = baseline active seconds / Qadam active seconds = 600 / 90 = 6.67x.
Reduction = (600 - 90) / 600 = 85%.

**Comparison rules:** both workflows use the same parcel, information, agreed price and scripted delivery events. Courier travel and passive waiting are excluded from active time and recorded separately. Add any extra negotiation, error correction or follow-up to the workflow that causes it.


## 06. Translate minutes into customer value

This is a scenario for labor capacity, not observed savings, cash profit or a pricing recommendation.

### MONTHLY TIME RELEASED
**40 orders x (10 - 1.5) min**
= 340 minutes
= **5.67 staff-hours/month**

40 orders/month is the earlier midterm assumption. [R2]

### ILLUSTRATIVE LABOR VALUE
**5.67 h x KZT 1,500/h**
= **KZT 8,500/month**
= KZT 212.50 per order

The loaded hourly labor cost is an unverified assumption.

### PAYMENT AND REVENUE
Courier delivery charge is separate.

Current pilot model: direct payment to the courier; **0% Qadam commission**. A future platform fee needs a separate willingness-to-pay test. [R4]

| Baseline active time | Qadam active time | Ratio | Interpretation |
| --- | --- | --- | --- |
| 8 min | 2 min | 4.0x | Misses the assignment target. Report this if observed. |
| 10 min | 2 min | 5.0x | Minimum target at this baseline. |
| 10 min | 1.5 min | 6.67x | Base engineering hypothesis. |
| 10 min | 1 min | 10.0x | Stretch target; no evidence currently supports it. |

Labor cost per order in this scenario: KZT 250 before and KZT 37.50 after. KZT 212.50 is a time-value ceiling before any fee or adoption cost; it does not justify the earlier midterm KZT 300 fee assumption. Saved capacity becomes cash savings only if staffing costs actually fall.


## 07. Measure the claim before using it in sales

Usability tests reveal bottlenecks. A separate, silent time study tests the modeled advantage.

| Design element | Predefined method |
| --- | --- |
| Sample and conditions | Proposed: 5 eligible shops x 10 matched scenario pairs = 50 pairs / 100 runs. This is a recruitment target, not completed research. Use equivalent parcels and events for both methods. |
| Control learning effects | Counterbalance order within each shop: five pairs manual-first and five Qadam-first. Give equal practice. Pin the build/version and record device, staff role and prior experience. |
| Start / stop and timing | Sum active order preparation, acceptance checking, status retrieval and completion lookup. Pause during identical scripted waiting periods. Keep wall-clock time and courier travel as separate measures. No think-aloud during timing. |
| Failures and additional effort | Record help, corrections, negotiations, retries and incomplete runs. Use a predefined 10-minute active-time cap per run; include capped failures in totals and report completion separately. Do not discard slow runs. |
| Primary calculation | R = sum(manual active seconds) / sum(Qadam active seconds) across all matched runs. Also report per-shop ratios, median paired ratio, range, completion rate and raw counts. |
| Decision rule | Support the 5x target only if R >= 5 and Qadam completion >= 90%. If lower, publish the measured result and revise the value proposition. A small controlled study does not establish citywide delivery performance. |

**Field follow-up:** a separately approved four-week pilot may target 5 shops and 50 completed deliveries, consistent with the earlier midterm proposal [R2]. Observe real interruptions, courier acceptance and repeat use; do not present that pilot as already launched.


## 08. The owner pays; the administrator adopts

Illustrative personas for a one-location Almaty shop. These are role hypotheses, not interviewed individuals.

| Buying role | Specific persona | Decision power / concern | Proof or action needed |
| --- | --- | --- | --- |
| CHAMPION | Aigerim, owner-manager of a small flower/gift shop. | Initiates the trial after repeated delivery interruptions; wants fewer coordination tasks. | Show one dispatch; agree on the current workaround and a measurable pilot goal. |
| END USER | Dana, sales / order administrator handling customer deliveries daily. | Uses the order form and status view; can reject adoption through non-use. | Unassisted task success, Russian copy, easy correction and a recovered order after reopening. |
| ECONOMIC BUYER | Aigerim, the same owner; controls delivery and software spending. | Approves any fee and operational change. Time savings must justify the total cost. | A written cost comparison, payment responsibilities and an explicit go / no-go decision. |
| BLOCKERS | Owner as data-responsible person; outsourced accountant if used. | Can stop use over recipient data, unclear payment records, service terms or unresolved support. | Review data handling, access, service/payment terms and responsibilities. Involve legal/IT only when the shop requires it. |
| INFLUENCER / CONSULTANT | Timur, an optional external IT helper; a trusted peer-shop owner. | Advises on ease of use, Telegram suitability and integrations; does not control the budget. | Explain launch steps, access controls, current limits and a reference pilot after evidence exists. |

Small-shop roles overlap. Do not invent a procurement department. Couriers and recipients affect service success, but they are not the shop economic buyer; the courier has a separate onboarding and operating journey.


## 09. Advance through explicit buying gates

Proposed pilot process. Durations and conversion rates are not measured.

| Stage / actor | Customer action and buying gate | Team evidence to retain |
| --- | --- | --- |
| 1. Awareness / champion | Recognizes repeat delivery interruptions; sees Qadam through a referral or direct shop demo. | Recent concrete delivery example; current workflow. |
| 2. Qualification / owner | Confirms service area, parcel suitability, Telegram access and authority to trial. Agrees to test-data use. | Eligibility checklist; pilot goal and consent. |
| 3. Pilot evaluation / end user | Runs representative order tasks with staged data. Reviews effort, errors, availability and support. | Task log, baseline comparison, unresolved blockers. |
| 4. Sign-off / owner + blockers | Before real deliveries, reviews cost, recipient-data handling, service terms and payment responsibilities; legal/procurement review if required. | Explicit owner approval; required terms accepted. |
| 5. Activation / administrator | Opens the bot, saves shop details and learns contacts and exception handling. No ERP connection is needed. | First successful test order and support contact. |
| 6. Routine use / administrator | Dispatches orders, checks progress and arranges direct courier payment. Records payment confirmation separately. | Completion, active-time and payment records. |
| 7. Review / owner | At four weeks, chooses continued use, stopping or expansion. Additional staff / volume follow only if service quality and economics hold. | Repeat orders, owner decision and reasons. |

Current pay-per-delivery model: retention means choosing Qadam again. Formal contract renewal applies only if a future recurring agreement is adopted.

## 10. Discover, launch, deliver, return

Shop journey across acquisition, operation and exit. Arrows show the normal sequence.

### 01 / DISCOVER
Owner receives a referral, bot link or shop demo and identifies a repeat-delivery use case.

### 02 / ACQUIRE
Owner checks fit and approves a limited trial, with costs and responsibilities made explicit.

### 03 / INSTALL / LAUNCH
Use existing Telegram; open @qadam_delivery_bot and its Mini App. Server validates Telegram login; no separate Qadam app install.

### 06 / PAY
Sender or informed recipient pays the courier by cash or manual Kaspi transfer. Delivered status alone is not payment confirmation.

### 05 / USE
Create order; courier accepts, collects, moves and completes it. Shop checks status and last-known location. Courier grants location consent.

### 04 / INTEGRATE
Enter a shop pickup profile and recipient data. Reuse orders if the test build supports it. No current ERP, CRM or Kaspi Pay API connection.

### 07 / MAINTAIN
Reopen retained orders, review history and ask the team to resolve exceptions. The server retains operational state.

### 08 / RENEW / EXPAND
Owner reviews the trial, repeats orders and considers more staff or volume. A paid platform plan is a future hypothesis.

### 09 / EXIT
Stop new dispatches; resolve active orders, outstanding payments and data requests under the service policy.

After retained use, the customer loops from 08 back to 05 for the next dispatch. Integration here means setup, not a software-system connection.

## 11. One Mini App, a server-owned order record

Solid flows describe the repository architecture; dashed boxes mark disabled, conditional or future integrations. [R1, R3-R7]

Telegram Mini App / React 19 + Next.js 16 + TypeScript + Tailwind 4; Leaflet map
**Data pipeline:** authenticated request -> validated transaction -> orders / events / outbox -> API polling (15 s list, 3 s open order while visible) and Telegram notifications. Location is last-reported data; no closed-Mini-App GPS guarantee.

Documented deployment: Vercel app/API + Supabase PostgreSQL in Frankfurt. Separate frontend/API/PostgreSQL containers are prepared locally; Kazakhstan server migration is not deployed. New module release status is on p.12.
Architecture: Telegram interfaces -> own Node/Next API -> PostgreSQL; API -> Telegram outbox transport and Geoapify; disabled TomTom price adapter; future Kaspi Pay/ERP/CRM/WhatsApp.


## 12. Separate working code from released behavior

Repository evidence is a design input; it is not a fresh production audit. Snapshot: 4 November 2026. [R1, R3-R6]

SEARCHING abbreviates SEARCHING_FOR_COURIER. CANCELLED is a separate, server-validated path. Events retain status history.
| Evidence category | Included behavior / limit | Use in the study |
| --- | --- | --- |
| Core documented / earlier release | Create, accept, update status, store/reopen an order, map and last-known position. | Verify on the pinned test build before recruiting; record its commit and deployment URL. |
| Code ready; release / phone checks pending | Saved shop profile and repeat orders (stage 6); photo/code (7); Telegram location stream (7.1); readiness and checkout map (7.2). | Use only enabled, verified features. T3 and the 90-second model depend on working repeat orders and saved pickup. |
| Disabled / conditional | Automatic price remains off. Cash/manual Kaspi payment goes directly to the courier. Photos and codes use server settings. | State the actual payment mode. Do not simulate a payment API or claim an off feature is live. |
| Future scope | Recipient/WhatsApp access; ERP/CRM and Kaspi Pay API integration; automatic background courier app. | Show as planned architecture only. Do not make usability success depend on future functionality. |

**Location rule:** active Mini App updates require consent and device access. Show timestamp / stale-state information. The optional Telegram chat stream has a separate setup and phone-validation gate; it is not automatic background tracking.


## 13. Three tasks for the shop user

Recruit 10 real participants: proposed mix of 6 shop administrators and 4 owner-managers. No completed sessions are claimed.

| Scenario / prompt | What the participant does | Success and timing target |
| --- | --- | --- |
| T1 / CREATE A FIRST ORDER; "A buyer needs a parcel delivered today. Arrange it in Qadam using this task card." | Open the bot/Mini App, enter staged pickup and destination, recipient and parcel details; review and submit. Moderator operates the courier account separately. | >= 9/10 unassisted, correct orders in <= 150 s. Correct addresses, recipient and no accidental duplicate. First-use time is not the 90-second repeat-dispatch model. |
| T2 / RECOVER AND EXPLAIN; "The buyer asks where the parcel is. Reopen Qadam, find the order and explain what you can tell them." | Close/reopen; retrieve the same order; identify status and responsible party. Include an explicitly staged old GPS timestamp so the participant must interpret it. | >= 9/10 recover the same order; >= 8/10 correctly explain status and stale location within 90 s. Must not call the old marker live. |
| T3 / REPEAT AND CORRECT; "Send a similar parcel to a different recipient. Reuse a completed order, correct the details and check the new order." | Open a staged completed order; repeat it; change recipient/contact and destination; retain suitable pickup details; review, submit and verify. | >= 9/10 unassisted correct repeats in <= 90 s. The new order has a new ID; the previous order remains unchanged. |

**Capture per task:** success / assisted / failed, elapsed time, errors, help requests, abandoned steps, SEQ ease rating (1 very difficult to 7 very easy), and a short verbatim quote with video timestamp. Targets are predefined criteria, not findings.

Use a consented test environment with staged recipient details and no real charge. Validate iPhone/Android behavior, refusal/empty/error states and text readability before the sessions. Keep the Russian MVP copy; the report is in English.

## 14. Ten live recordings, traceable to findings

Each full session must last at least 3 minutes. Plan 10-12 minutes for consent, three tasks and debrief.

### RECORDING PROTOCOL
Obtain recording and classroom-sharing consent. Capture the real participant navigating the MVP; encourage think-aloud without coaching.

Keep raw full recordings. Create a 15-30 s highlight for an observed bottleneck, confusion or "aha" moment; preserve its source timestamp.

### FINAL PRESENTATION + DRIVE
Embed the selected highlight clips directly in the final slides. The PDF does not replace embedded video.

Upload all full sessions to a Google Drive folder, grant instructor access and test the link from a signed-out / permitted account. Folder link: **pending upload**.

| ID | Target role | Full video | Duration | Clip / timecode |
| --- | --- | --- | --- | --- |
| U01 | Administrator | Pending | Pending | Pending |
| U02 | Administrator | Pending | Pending | Pending |
| U03 | Administrator | Pending | Pending | Pending |
| U04 | Administrator | Pending | Pending | Pending |
| U05 | Administrator | Pending | Pending | Pending |
| U06 | Administrator | Pending | Pending | Pending |
| U07 | Owner-manager | Pending | Pending | Pending |
| U08 | Owner-manager | Pending | Pending | Pending |
| U09 | Owner-manager | Pending | Pending | Pending |
| U10 | Owner-manager | Pending | Pending | Pending |

Completion standard: 10 real sessions >= 3:00 each; all raw files accessible; clips linked to observed evidence. Current supplied count: 0.

## 15. Twenty more people, separate from testing

Interpretation: recruit 20 unique feedback respondents who are not any of the 10 recorded usability participants.

### FEEDBACK INTERVIEW / SURVEY
**Q1.** Describe your last actual shop delivery.
**Q2.** Which tools and active steps did you use?
**Q3.** Where did coordination break down?
**Q4.** After the demo, which part would you use or avoid, and why?
**Q5.** What prevents trying Qadam next week?
**Q6.** What delivery/software costs did you actually pay last month? What would need to change to approve a paid trial?

### TURN EVIDENCE INTO INSIGHTS
Store exact quote / behavior, participant role, source and date; then add interpretation, severity, proposed change and validation status.

Report theme counts as n/20 after collection. Preserve contradictions. An opinion is not an observed usability failure.

| ID | Recruitment target | Date | Evidence |
| --- | --- | --- | --- |
| F01 | Owner | Pending | Not collected |
| F02 | Owner | Pending | Not collected |
| F03 | Owner | Pending | Not collected |
| F04 | Owner | Pending | Not collected |
| F05 | Owner | Pending | Not collected |
| F06 | Owner | Pending | Not collected |
| F07 | Owner | Pending | Not collected |
| F08 | Owner | Pending | Not collected |
| F09 | Owner | Pending | Not collected |
| F10 | Owner | Pending | Not collected |
| F11 | Administrator | Pending | Not collected |
| F12 | Administrator | Pending | Not collected |
| F13 | Administrator | Pending | Not collected |
| F14 | Administrator | Pending | Not collected |
| F15 | Administrator | Pending | Not collected |
| F16 | Administrator | Pending | Not collected |
| F17 | Administrator | Pending | Not collected |
| F18 | Administrator | Pending | Not collected |
| F19 | Administrator | Pending | Not collected |
| F20 | Administrator | Pending | Not collected |

Planned total: at least 30 unique people across the two groups. ID overlap must be checked. No responses, quotes or insight counts have been invented.

## 16. What is ready, and what still needs evidence

Canvas availability supplied in the assignment: 4 Nov 09:30 to 6 Nov 19:45, 2026. No separate due date was listed.

| Requirement | Report location | Status |
| --- | --- | --- |
| Visual VPC + quantified advantage | Pages 3-7 | Canvas and 6.7x model prepared; measured advantage pending. |
| DMU + buying process | Pages 8-9 | Specific illustrative personas and approval gates prepared. |
| Life cycle + product architecture | Pages 10-12 | Diagrams prepared; current / conditional / future scope separated. |
| Testing setup + proof by ISC2 / Final | Pages 13-15; companion workbook | Plan prepared; 10 videos, final-slide clips, Drive link and 20 feedback records pending. |

SOURCE AND ASSUMPTION REGISTER
[R1] Project roadmap: docs/ROADMAP.md, snapshot 4 Nov 2026; stages, release gates, current stack and operating limits.
[R2] Qadam Delivery English Speaking Script, deliverables/Qadam-Midterm-English, 23 Oct 2026; prior research statements and scenario assumptions.
[R3] Repository README.md; src/lib/orders.ts; src/components/delivery-app.tsx; src/lib/telegram.ts; local source snapshot inspected 4 Nov 2026.
[R4] docs/PRICING_PILOT.md and docs/STAGE_5_LAUNCH.md; direct payment, zero commission, tariff disabled; approval is not validation.
[R5] docs/STAGE_7_2.md and docs/ROADMAP.md; release / device checks for repeat orders, trust, location and readiness features.
[R6] docs/BACKEND_API.md and docs/ROADMAP.md; local separate API preparation versus documented deployed architecture.
[R7] Telegram, Mini Apps documentation, accessed 4 Nov 2026: https://core.telegram.org/bots/webapps (launch, authentication and permissions).
[R8] Strategyzer, The Value Proposition Canvas, accessed 4 Nov 2026: https://www.strategyzer.com/library/the-value-proposition-canvas (six-part framework).
ASSUMPTIONS: 40 orders/month; 600 s manual; 90 s Qadam; KZT 1,500/hour. Targets: 5-10x, 10 sessions, 20 separate feedback respondents. No empirical improvement or research completion is asserted.
