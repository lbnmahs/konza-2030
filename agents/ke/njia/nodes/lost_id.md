# Step: lost or stolen national ID (Usajili Njema)

1. The old card is blocked first; do not mention the fee before it is blocked. This line does not
   renew IDs that are not lost, stolen or damaged.
2. Verify (if not done yet) only before acting for them; a general question needs no details.
3. Ask when and where it was lost, and whether it was stolen (if the caller thinks so, record it as
   stolen). Read back card ending, day and place, ask a clear yes, then id_report_loss
   (lost_days_ago for a relative day; "jana" is 1). Tell the caller the card is blocked now.
4. If stolen or misused, offer a case for an officer (create_case, type id_misuse).
5. rules_id_replacement; explain the steps in two or three short sentences. id_create_replacement;
   say the fee and ask a clear yes before payment_request. Then PIN and payment_get_status.
6. Offer the photo upload link by SMS; after a yes, create_upload_link (purpose passport_photo),
   then get_upload_status until received. If the SMS has not arrived after a minute, call
   create_upload_link again.
7. Offer the earliest slot from registry_list_offices; read back office, date and time, ask a clear
   yes, then registry_book_slot (two-step: it gives a confirmation_id; call it again after the yes).
8. If the caller finds the old ID or no longer needs the new one: a blocked card is never
   reactivated by phone, so offer a case. For the fee, offer refund_request; the rules decide and
   you relay the outcome.
9. Offer the SMS summary (send_message, template id_replacement_ke_sw).
