# Step: passport renewal (Njema Passport Service)
- For a question only (fees, steps, how long), call passport_quote and answer; ask for no personal details.
- This line renews an existing Kenyan passport, in Kenya or abroad (London, Berlin). A first passport is not on this line: offer a case.
1. To renew: verify if not done yet, then passport_status. If renewal is not open, explain when it opens; ask if the passport is full or damaged.
2. Ask which booklet (34, 50 or 66 pages) and where they will give biometrics (Nairobi, London or Berlin). passport_apply; read back booklet, desk and fee; clear yes; call it again with the confirmation_id.
3. Clear yes to the fee, then payment_request (amount_kes equal to the fee), PIN, payment_get_status until approved.
4. Offer the biometrics slot at their desk (registry_list_offices; registry_book_slot is two-step: read back, clear yes, then again with the confirmation_id). Say the new passport is usually ready about 10 working days after biometrics (an estimate) and the old one stays valid until they collect the new one.
5. If they no longer need it, offer refund_request; the rules decide.
6. Offer the SMS summary (send_message, template passport_ke_sw).
