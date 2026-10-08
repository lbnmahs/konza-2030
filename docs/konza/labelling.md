# Labelling rules

K1 (MED-253), 5 Oct 2026; label changed by Mahs on 8 Oct 2026 for the konza-2030 release. The agencies, people and records are synthetic. A real Konza Technopolis exists and is itself a smart city and special economic zone run by KoTDA, and Kenya's tech scene is branded "Silicon Savannah", so nothing we show may be mistaken for them or for any other public body.

## The label

- Text, exactly: **Independent open-source project · not affiliated with any government body**
- Where: on every page of the web app (rendered by `web/app/layout.tsx` from `web/lib/labels.ts`), on every slide, video frame and shared screenshot. The README, NOTICE and policy files end with one line: "Independent open-source project. Not affiliated with the Konza Technopolis Development Authority or any government body."
- Swahili, where a page is in Swahili: **Mradi huru wa chanzo huria · hauhusiani na chombo chochote cha serikali** (native review in K5).
- Every SMS and email subject carries **DEMO**. Every agent says it is an AI assistant in its first message.

## Never

1. Real crests, coats of arms, flags, seals, logos, colour schemes or typefaces of any government or agency (Kenya's coat of arms, KoTDA, eCitizen, Huduma, KRA, SHA, the UK's or UAE's government brands).
2. Real officials' names, photos or voices, or a voice that imitates one; any real person's voice without written consent (`docs/konza/voice.md`).
3. KoTDA's real plans, maps, zone or plot numbers, building names or photos of the real site, and "Silicon Savannah" branding; our addresses use our own format (`docs/konza/world.md` section 3).
4. Real domains or look-alikes (`.go.ke`, `gov.*`, `konza.go.ke`, `ecitizen`), real phone numbers other than our own number, real payment brands (M-PESA, card schemes) as if they were ours.
5. Words that claim authority we do not have: "official", "government of Konza" outside the story text, "approved by", "in partnership with".
6. Real ID, passport or resident number formats in seeds: Konza numbers use `QK-` and phones use the Ofcom drama range.

## Look-alike review (before each gate and any sharing)

- [ ] The label shows on the page or frame, readable at phone width.
- [ ] No body named in `docs/konza/world.md` section 2's "never name" list appears as ours.
- [ ] Every new name was searched (date and result recorded in `world.md`).
- [ ] Colours, icons and typefaces are our own neutral set.
- [ ] Voices are library or designed voices, disclosed as AI.
- [ ] The script or screen never says a real body launched, approved or runs it.
- [ ] Numbers and IDs on screen are in synthetic formats.
