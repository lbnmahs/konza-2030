# Konza resident app: UI rules (K8, MED-334)

The resident app `/sia` (plan-k8 sections 2.1 to 2.7). Target: WCAG 2.2 AA. The backend decides every card (ui/v1); the model never draws the screen. English only for now (Mahs, 12 Oct): Savannah may speak Swahili, the cards stay English.

## Catalog

- One source: `spec/konza-2030-api/ui/catalog.schema.json` (`ui/v1`), examples in `ui/examples.json`, changes in `CHANGELOG.md`. Web copies in `web/lib/ui/` with a drift test.
- Kinds: `progress`, `quote`, `identity`, `form`, `confirm` (variants `action` and `consent`), `slots`, `payment`, `receipt`. Unknown kinds are never drawn.
- Text is text: no `dangerouslySetInnerHTML` in the resident app (lint rule `react/no-danger`); the injection fixture (`/dev/cards?screen=injection`) proves markup in a caption or a card is shown, never run.
- Fields that hold an id are choices the backend fills (`x-konza-options`, `ui/options.ts`), never typed (plan 2.4, MED-333).

## Tokens

`web/components/resident/resident.module.css`, light then dark:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f7f8f9` | `#141517` | page |
| `--surface` | `#ffffff` | `#1c1d20` | cards |
| `--text` | `#16191d` | `#eceef0` | body text |
| `--muted` | `#545b64` | `#a6acb4` | secondary text |
| `--accent` | `#4b5f75` | `#a7b6c8` | selection, focus, primary button |
| `--edge` | `#7b828b` | `#7a8088` | control borders (3:1) |
| `--line` | `#e1e4e8` | `#33363b` | decorative rules only |
| `--ok`, `--warn`, `--error` | `#1d6b3f`, `#7a5000`, `#a3241c` | `#6fcf97`, `#e3b25c`, `#ff8a80` | status, always with a word and an icon |

Colour is never the only signal: the orb's tone sits beside a state word, a status has a word and an icon, and Savannah never says a colour (agents/blocks/accessibility.md).

Type: Instrument Serif (headings), Montserrat 400 and 600 (the rest), Diplomata SC (the SIA wordmark only), self-hosted by `next/font`.

## Focus and keyboard

- Every control is reachable by Tab in reading order and shows a 2 px accent ring on `:focus-visible` (the message box too, around its frame).
- The first Tab stop is "Skip to content", shown only on focus, past the navigation to the view's heading.
- Focus moves only when the resident opens applications or settings from the navigation: to that view's heading, so it is announced. A new card never takes focus: it is announced through the status region, and the resident moves to it.
- The sidebar toggle says whether the sidebar is open (`aria-expanded`); the current view is `aria-current="page"`.
- Confirm stays focusable during its 4 s wait (`aria-disabled`, not `disabled`).
- Targets are at least 24 by 24 CSS px (2.5.8); the main buttons are 44 px.

## Live regions

- Status regions (`role="status"`): one announces each new card ("Confirm. Details on screen.") and a payment received, one carries tap notices, and each timed card has its own for time left.
- The conversation thread is `aria-live="polite"`; replies stream in parts, so a screen reader may read them in pieces.
- Timed cards (confirm, code, payment) say once when a minute is left and when time is up (2.2.1), and offer Refresh or Start again.

## Motion

- The WebGL orb loads only when WebGL works and motion is allowed (`prefers-reduced-motion` and Settings "Reduce motion"); otherwise the CSS orb, still.
- With motion allowed a card grows in (360 ms) and the orb changes size (420 ms), no bounce; with reduced motion a card only fades in (200 ms) and sizes change at once.

## Checks

- `npm --prefix web run test:a11y` (Playwright on the installed Chrome, local only, no sign-in, no session, no credits): axe on every preview screen in both themes (zero serious or critical), reflow at 320 px and at 640 px (200% zoom of 1280), 24 px targets, Tab to the main action of the form, confirm, consent, slots and payment cards with visible focus, a status region per card, reduced motion, the injection fixture, the skip link and focus to the view heading.
- Keyboard pass of the `/sia` shell on the live app, no session (17 Oct, Claude in Chrome on Mahs's signed-in Chrome, Tab and Shift+Tab only): reading order sidebar, view, message box; no trap; a 2 px ring on every button; 44 px targets; one `h1` per view; landmarks; labelled radio groups, switch and slider. Found and fixed: no skip link, focus left on the sidebar after opening a view, no `aria-expanded` on the sidebar toggle, a hairline focus change on the message box.
- `npm --prefix web run build` fails if `/sia` first-load JS passes 150 KB gzip (`scripts/budget.mjs`).
- Throttled load of `/sia` (17 Oct, Lighthouse Mobile in DevTools, signed in: slow 4G, 4x CPU): FCP 1.0 s, LCP 2.1 s, TBT 40 ms, CLS 0, Speed Index 1.0 s, score 99. Use the DevTools Lighthouse panel in a signed-in tab; the Lighthouse extension runs headless without the sign-in.
- Not part of K8: a keyboard run inside a live session, VoiceOver (iOS) and TalkBack (Android).
