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
2. Test calls are deleted when a phase closes unless cited as evidence in a results file, and then only the conversation id is kept in the repo.
3. Mahs's Swahili script call (K5) is scored from its transcript only; no audio is kept.

**SIA (Savannah), K3 (MED-283):** Mahs chose **Halima** on 6 Oct 2026 from three free Voice Library previews (Halima, Wanjiru, Achieng). K5, 7 Oct: kept on `eleven_v4_turbo` after Mahs judged the Swahili okay; no bake-off. Voice id `i5oE89JoUCpIgvSOemWx`; a generated (designed) voice, not a clone of a real person; live moderation off; free-tier use allowed; already in the account. Only generated voices were offered: professional library voices are clones of real people. `push-agents` refuses a placeholder voice.
