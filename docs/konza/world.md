# Konza world bible

K1 (MED-251), 5 Oct 2026; names and the city framing set by Mahs on 5 Oct. Every value here is designed unless marked **sourced** or **modelled**. Konza is a **city**: a special, sandboxed economic zone that borrows from Kenya (mobile money, Swahili, the passport journey), the UAE (one front door that acts for you), Estonia (once-only data, a log of who touched your data) and the UK (plain language). Its agencies carry the name **Savanahlands** (one n, always). Its assistant acts for residents, always says why, and keeps a human review route. Charter: `docs/konza/charter.md`.

## 1. City facts

| Fact | Value | Why |
|---|---|---|
| Name | Konza, a city and sandboxed economic zone | Kickoff and Mahs (5 Oct). The real Konza Technopolis is itself a smart city and special economic zone run by KoTDA, so the label and the never-imitate list (below, and `docs/konza/labelling.md`) matter more, not less |
| Code | `KONZA` in code, `QK` where two letters are needed | `KZ` is Kazakhstan; `QK` is in the ISO user-assigned range |
| Currency | KES | Fees reuse sourced Kenyan figures where they exist |
| Time zone, holidays | Africa/Nairobi, Kenyan public holidays (`rules/ke/calendar.ts`) | Reuse; the audience is Kenyan |
| Languages | English, Swahili, Sheng (understood; spoken in a Swahili frame, judged in K5) | Kickoff |
| Resident number | `QK-` then 8 digits (`QK-1234-5678`), synthetic; plays the role the Maisha Number has in Kenya's interoperability framework | Must never look like a real Kenyan ID or Maisha Number |
| Passports | Konza processes **Kenyan** passports at its own biometrics desk (by agreement, in the story) | Kickoff; turns the brief's physical-visit gap into a scene |
| Addresses | Every building and unit has a precise address (section 3) | Mahs (5 Oct): lets the system run deliveries |

## 2. Who does what (names designed and checked against real bodies)

| Body | Role in Konza | Name check |
|---|---|---|
| **Savanah Information and Access (SIA)** | The resident's assistant. Persona **Savannah**. Acts only through the bodies below | 5 Oct: no match for "Savanah Information and Access" or "Savanahlands". SIA is also Singapore Airlines and the UK Security Industry Authority: say the full name at first use. "Savannaspace" (a Kenyan AI team) exists; not confusable |
| **Savanahlands Residents Registry (SRR)** | Arrival: resident number, address, family links | 5 Oct: no match |
| **Savanahlands Passport Services (SPS)**, Konza Passport Desk | Kenyan passport renewal, biometrics inside Konza, home delivery | 5 Oct: no match |
| **Savanahlands Cover Authority (SCA)** | Health cover, family dependants | 5 Oct: no match |
| **Savanahlands Company Office (SCO)** | Business name or company registration, tax number, trading permit | 5 Oct: no match |
| **Savanahlands Institute of Learning and Nurturing (SILN)** | School places for children | 5 Oct: no match |
| **Lango Square**, the Savanahlands Residents Registry public counter (`Z1 B01 P001 U01`, working days 8 to 5) | Pay any fee at the counter (PY-02), hand in paper documents (DK-01), collect anything but a passport (DK-02) | 5 Oct (Mahs chose the name, replacing Mlango Desk): no Kenyan body, brand or place called Lango Square; `lango` is Swahili for gate; Lango is also a Ugandan people and sub-region, not a body or brand, so not confusable |
| **Aminia Review Panel** | Human review of any decision; answers appeals | 5 Oct: no match (Amina is a common name; no body called Aminia) |
| **Mirror Vale Audit Office** | Independent check that the assistant acts safely (the Audit Office role); never shown on public pages | 5 Oct: no match. Replaces "Thinking Machines Auditing", which clashes with Thinking Machines Lab, a real AI company |
| City courier (unnamed) | Delivers documents to registered addresses (section 3) | No brand |
| Pesa Simulator (`/pesa`) | Mobile money PIN screen, simulated | Generic label, no brand |
| Regression only: Pwani Njema County (market permit), Wezesha Njema Council and Kodi Njema Revenue Service (disability exemption) | Kept as backend regression tests, not Konza scenes | Wave 2 |

The live KE agent still uses its P13 names (NJIA, persona Baraka, the Njema authorities) until K3 moves it to these names.

Real bodies and brands we never name or imitate: KoTDA, its plans, zones, plot numbers and "Silicon Savannah" branding (including the Silicon Savannah Intelligent Operations and Experience Centre), ICTA, Huduma, eCitizen, SHA, KRA, BRS, Directorate of Immigration Services, NTSA, Biashara Centres, Safaricom and M-PESA (and its chatbot Zuri), Office of the Auditor-General, Thinking Machines Lab.

## 3. Addresses and deliveries

Konza has a complete, precise addressing system (designed; not KoTDA's real layout).

- **Format:** zone (1 to 9), block (letter and two digits), plot (three digits), unit (two digits). Written `Z3 B12 P047 U02`; spoken "zone three, block B twelve, plot forty-seven, unit two". Every address also has a 6-character check code that is read back for deliveries.
- **One address per resident** in the registry, verified on registration (AR-02); agencies read it from there (AR-04) and never ask again.

| Id | Rule | Mark |
|---|---|---|
| AD-01 | Every plot and unit in Konza has a unique address and check code | designed |
| AD-02 | Deliveries go only to the resident's registered address, or are collected at Lango Square (DK-02) or, for passports, the Konza Passport Desk; the address is read back before booking | designed (amended K3, MED-278) |
| AD-03 | Delivery is the next working day, morning (8 to 12) or afternoon (2 to 6) | designed |
| AD-04 | Delivery costs KES 200 per item; collection at a desk is free | designed |
| AD-05 | The courier hands over to the named resident or, for a child's document, a parent with consent; the recipient confirms with a one-time code | designed |
| AD-06 | Passports can be delivered home, handed only to the holder in person, who shows ID and gives the one-time code; or collected at the Konza Passport Desk | designed (a real Kenyan passport is collected in person) |

## 4. Rules and fees

Every value lives in the rules module with its id; the LLM never states one it did not get from a tool. Marks: **sourced** (URL), **modelled** (shaped on a real rule, simplified), **designed** (invented for this system).

| Id | Rule | Mark |
|---|---|---|
| AR-01 | Registering as a resident is free; the resident number is issued once identity is checked against the Kenyan ID or passport | designed |
| AR-02 | An address is registered with a tenancy agreement or an employer letter (upload) | designed |
| AR-03 | A parent or guardian registers a child under 18 with the birth certificate; the child is linked to both parents where known | modelled (DPA s33, parental consent) |
| AR-04 | Once registered, other Konza bodies read the resident's details from the registry and do not ask again | modelled (once-only, GIF p14) |
| PP-01 | Passport fees: 34 pages KES 7,550; 50 pages KES 9,550; 66 pages KES 12,050 | sourced: immigration.go.ke/type-and-fees (checked 1 Oct 2026) |
| PP-02 | Renewal opens within 12 months of expiry, after expiry, or when full or damaged | modelled |
| PP-03 | Apply online, pay, then biometrics in person at the Konza Passport Desk, inside Konza: any working day within the next 10 working days, morning (8 to 12) or afternoon (2 to 5); the appointment can be moved until the day before | modelled (real journey has nine centres, none at Konza); booking window and moving added 6 Oct after Mahs's calls (MED-299), approved by Mahs the same day |
| PP-04 | Ready about 10 working days after biometrics | modelled (approximate) |
| PP-05 | The old passport stays valid until the new one is handed over (collected or delivered); the old one is cancelled at handover | modelled |
| SH-01 | Cover is active only when this month's contribution has cleared | modelled on SHA |
| SH-02 | Minimum contribution KES 300 a month | modelled on SHA's minimum |
| SH-03 | Children are added as dependants with a birth certificate or notification | modelled |
| SH-04 | A dependant request is decided within 2 working days; cover starts at approval | designed |
| BZ-01 | Business name registration KES 950, usually 1 to 2 days | sourced, approximate: commercial guide (kolonell.com, 2026), not an official page |
| BZ-02 | Private limited company KES 10,500, 3 to 7 days | sourced, approximate: same guide |
| BZ-03 | A tax number is issued with the registration, without a second form | modelled (KRA PIN with incorporation, once-only) |
| BZ-04 | A trading permit for a small workshop: KES 5,000 a year | designed |
| BZ-05 | A name already registered, or one that suggests a government body ("Konza", "Government", "Authority", "Technopolis"), is refused; refusals go to an officer | designed |
| ED-01 | Public primary school places are free | modelled (Kenyan free primary education) |
| ED-02 | Only a parent or guardian with recorded consent may apply for a child; birth certificate and immunisation card | modelled (DPA s33) |
| ED-03 | Places by catchment first, then distance, then capacity | designed |
| ED-04 | If the preferred school is full, the nearest school with space is offered; the resident may ask for review | designed |
| ED-05 | A place is confirmed within 5 working days | designed |
| ED-06 | Primary places are for children aged 5 to 13 on the day of the application | designed |
| RV-01 | Any decision can be reviewed by the Aminia Review Panel if asked within 30 days | modelled on the Technopolis Dispute Resolution Tribunal (30 days, ss48 to 61, as summarised in the brief; to check against the Act) |
| RV-02 | A human officer who did not make the decision reviews it; the review is free | designed |
| RV-03 | The answer comes within 10 working days, with reasons | designed |
| RF-01 to RF-05 | Refunds (`rules/common/refunds.ts`) | designed |
| PY-01 | Any Konza fee can be paid on the phone itself: SIA sends a "DEMO" prompt (payee, amount, reference) by SMS or by a code call; the resident approves by saying or texting back the 6-digit code within 5 minutes; ignoring it declines; three wrong codes decline it | designed (K3, MED-278: no smartphone needed) |
| PY-02 | Any fee can be paid at any Konza desk (Lango Square or the Konza Passport Desk); an officer records it against the reference; the amount must equal the open charge | designed (K3, MED-278) |
| DK-01 | Lango Square takes paper documents (tenancy, employer letter, birth certificate, immunisation card); an officer checks them and records type and result; the paper goes back and nothing is scanned; the record counts wherever an upload is accepted | designed (K3, MED-278: no upload needed) |
| DK-02 | Any deliverable can be collected free at Lango Square with ID and a one-time code, with no address needed; passports are collected only at the Konza Passport Desk (AD-06) | designed (K3, MED-278) |

Forms are fields, not paper: each application in K2 is an OpenAPI schema; uploads are checked by type and size and never stored.

## 5. The family (invented)

The **Njoroge** family moves to Konza. Mahs plays Laban (his own first name, by his choice); the surname and everything else are invented; numbers use the drama range and the `QK-` format.

| Person | Age | Their part in the week |
|---|---|---|
| Laban Njoroge | 39 | Kenyan passport expires in 5 months; starts a small solar repair workshop |
| Neema Achieng Njoroge | 36 | Health cover member; adds the children |
| Imani Njoroge | 9 | Needs a primary school place (a parent acts for her) |
| Tumaini Njoroge | 3 | Health cover dependant |

## 6. The first week (scene by scene)

Charter levels: **alone** (acts without asking), **asks** (read-back and a clear yes first), **never** (only an officer decides; SIA submits and explains).

| Day | Scene | Steps (charter level) | Decision and review |
|---|---|---|---|
| Mon | Arrival | Explain what is needed (alone); register Laban and Neema (asks); upload tenancy (asks); register the children as their parent, consent recorded (asks); resident cards delivered to the family address (asks, AD-02 to AD-05) | Resident numbers by rule AR-01 with reason; any refusal goes to an officer (never); review RV-01 |
| Tue | Passport (first scene built, K3) | Quote fees without identity (alone); check renewal is open (alone); apply (asks); pay (asks); book biometrics at the Konza desk (asks); calendar and SMS summary (alone, own data); home delivery or collection (asks, AD-02 to AD-06) | Renewal opening by PP-02; issuing the passport is never SIA's; review RV-01 |
| Wed | Health cover | Check status (alone); pay the month's contribution (asks); add Imani and Tumaini with documents (asks) | Cover by SH-01; dependants by SH-04 with reason; refusals to an officer |
| Thu | Business | Check a name is free (alone); register the business name and get the tax number in one go (asks, pays); trading permit (asks, pays); certificate delivered to the workshop address (asks) | Name refusal under BZ-05 decided by an officer (never); permit by rule; review RV-01 |
| Fri | School | Show schools by catchment (alone); apply for Imani as her parent (asks) | Place under ED-03 with reason; if the preferred school is full, ED-04 offers another and says how to ask for review |

Every step that changes something leaves an explain-why receipt: what was done, the rule, the inputs, and how to ask for review. Today-versus-Konza numbers (for the story): the real passport journey has five steps and a visit to one of nine centres; in Konza it is one call and a visit to a desk inside Konza.
