"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabase } from "@/lib/supabase";

// Panel sign-in with a one-time code by email (Supabase Auth). Only allowed addresses get one.
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/auth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setStage("code");
    setMessage("If this address may sign in, a code is on its way.");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await getSupabase().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setMessage("That code did not work. Check it, or ask for a new one.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main style={{ maxWidth: 360, margin: "15vh auto", padding: 16, fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 20 }}>Sign in to the demo panel</h1>
      {stage === "email"
        ? (
          <form onSubmit={sendCode}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ display: "block", width: "100%", margin: "8px 0 12px", padding: 8 }}
            />
            <button type="submit">Send code</button>
          </form>
        )
        : (
          <form onSubmit={verify}>
            <label htmlFor="code">Code from the email</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ display: "block", width: "100%", margin: "8px 0 12px", padding: 8 }}
            />
            <button type="submit">Sign in</button>
          </form>
        )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
