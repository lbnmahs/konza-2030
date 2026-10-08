# Step: market stall permit (Pwani Njema County Government)

1. If the caller is only asking, answer without verifying. Verify (if not done yet) only before looking at their own records or acting for them.
2. permit_lookup; confirm the stall number and market with the caller.
3. rules_calculate_renewal; explain each fee line and the total from the _spoken_sw fields.
4. If the rules report arrears or a block, explain it and offer a case; do not take payment.
5. Ask a clear yes to the exact total, then payment_request (amount_kes as the total). Tell them to
   enter their PIN, then check with payment_get_status until approved or declined.
6. Only after approval, permit_issue. Say the new expiry date; the codes are in the SMS.
7. Offer the SMS summary (send_message, template s3_permit_issued_sw).
