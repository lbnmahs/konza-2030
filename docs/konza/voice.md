# Voice consent and AI-voice disclosure

K1 (MED-254), 5 Oct 2026. Grounds: ElevenLabs' use policy (cloning needs the speaker's consent or legal right; users are told they talk to AI; never imitate elected officials, even with consent), Kenya's AI Bill 2026 (not law yet: explicit consent and an AI label for any voice or likeness), and the Data Protection Act (voiceprints are biometric data, which is sensitive).

## Which voices

1. **Allowed:** ElevenLabs Voice Library voices shared for use by their creators, and voices designed from a text description. Today: the live KE agent's library voice (persona Baraka, P13). The Savannah persona uses Halima (below); the K5 bake-off was dropped on 7 Oct.
2. **Allowed with written consent:** a real person's voice (Mahs or a family member), cloned only after a signed, dated consent naming the use (konza-2030), the engine, and how to withdraw. The consent is kept outside the repo; the repo records only that it exists and its date. Withdrawal deletes the clone within 7 days.
3. **Never:** an official's, public figure's or real agency spokesperson's voice, or a voice made to sound like one; a child's voice; a voice cloned from audio found online or from a call recording.
4. Every voice in use is listed here with its source and consent date.

| Voice | Used by | Source | Consent |
|---|---|---|---|
| Baraka | NJIA, the live KE agent until K3 | ElevenLabs Voice Library | Library terms |
| Savannah | SIA (Konza) | Halima, ElevenLabs Voice Library (generated voice), on `eleven_v4_turbo` | Library terms; no person's voice |

## Saying it is AI

1. The first message in every language says the assistant is an AI: "Mimi ni Savannah, msaidizi wa AI" / "I'm Savannah, an AI assistant" (today the live agent says "Mimi ni Baraka, msaidizi wa AI").
2. If asked "are you a person?", it says no, every time, in the caller's language.
3. A synthetic voice is never presented as a person, a named officer, or a real member of staff; voices in any recording carry "AI voice" on screen.
4. Recorded clips we publish (`/demo`) carry the label and "AI voice".

## Recording and keeping

1. Agents keep no audio (`record_voice: false`) and keep transcripts 30 days; the backend keeps only hashes of calling numbers.
2. Test calls are deleted when a phase closes. Conversation ids are not kept in the repository.
3. Mahs's Swahili script call (K5) was scored from its transcript only; no audio was kept; the transcript was then deleted.

**SIA (Savannah), K3 (MED-283):** Mahs chose **Halima** on 6 Oct 2026 from three free Voice Library previews (Halima, Wanjiru, Achieng). K5, 7 Oct: kept on `eleven_v4_turbo` after Mahs judged the Swahili okay; no bake-off. Voice id `i5oE89JoUCpIgvSOemWx`; a generated (designed) voice, not a clone of a real person; live moderation off; free-tier use allowed; already in the account. Only generated voices were offered: professional library voices are clones of real people. `push-agents` refuses a placeholder voice.

## Swahili error rate (K5, MED-304)

Mahs read the 10 script phrases (`deno task wer`) on one call to SIA on 8 Oct 2026 (379 s, his own voice, no audio kept; conversation id kept in the private K7 notes). Scored from the transcript with `deno task wer <id>`, each phrase aligned to its best-matching turn:

| | Word error rate |
|---|---|
| All 10 phrases | **13.9%** |
| Critical phrases (amounts, dates, resident number, address, read-back) | **13.2%** |

| Phrase | Errors / words | Note |
|---|---|---|
| amount 1 (KES 7,550) | 7 / 14 | "kurasa thelathini" heard as "rasa la sini"; the amount itself right |
| amount 2 (KES 950) | 2 / 18 | amount right |
| amount 3 (KES 12,050) | 5 / 14 | page count and "pasipoti" said as "passport"; amount right |
| date 1 | 1 / 26 | |
| date 3 | 0 / 17 | |
| resident number | 0 / 17 | |
| address | 1 / 18 | |
| consent | 1 / 23 | |
| read-back | 3 / 20 | "kurenew" said as "renew" |
| refusal to an officer | 6 / 20 | |

Every shilling amount, the resident number and both dates were heard right; most errors are page counts and code-switched words. This is why amounts and dates are read back from the rules and never taken from what the caller said.

The call itself found an outage: every tool call returned 403 after the key rotation, because the ElevenLabs secret and post-call webhook were never updated (see the key rotation runbook, kept private); fixed the same day.
