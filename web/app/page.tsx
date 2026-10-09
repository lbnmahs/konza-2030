"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { AuditRow, Authority, Conversation } from "@/lib/types";
import {
  ROW_TIME_ZONE_LABEL,
  authorityName,
  formatClock,
  formatDuration,
  formatStart,
  formatTime,
  languageName,
  timezoneCity,
} from "@/lib/labels";
import styles from "./panel.module.css";

const FOLLOW = "__follow__";

const ACTOR_COLOURS: Record<string, string> = {
  Call: "#8b98a8",
  Identity: "#d2a8ff",
  Service: "#58a6ff",
  Rules: "#f0883e",
  Payment: "#3fb950",
  "Follow-up": "#39c5cf",
  Escalation: "#f85149",
  Language: "#e3b341",
  Upload: "#f778ba",
  Partner: "#a5d6ff",
  Accessibility: "#7ee787",
};

// Rows that arrived over realtime carry this flag so only they animate.
type PanelRow = AuditRow & { live?: boolean };

function byStartedDesc(a: Conversation, b: Conversation) {
  return Date.parse(b.started_at) - Date.parse(a.started_at);
}

function byTsDesc(a: AuditRow, b: AuditRow) {
  const d = Date.parse(b.ts) - Date.parse(a.ts);
  return d !== 0 ? d : b.id - a.id;
}

function mergeRows(existing: PanelRow[], incoming: PanelRow[]): PanelRow[] {
  const map = new Map<number, PanelRow>();
  for (const r of existing) map.set(r.id, r);
  for (const r of incoming) if (!map.has(r.id)) map.set(r.id, r);
  return [...map.values()].sort(byTsDesc);
}

function upsertConversation(list: Conversation[], c: Conversation) {
  const rest = list.filter((x) => x.id !== c.id);
  return [...rest, c].sort(byStartedDesc);
}

export default function AuditPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoaded, setConvLoaded] = useState(false);
  const [rowsByConv, setRowsByConv] = useState<Record<string, PanelRow[]>>({});
  const [loadedConv, setLoadedConv] = useState<Record<string, boolean>>({});
  const [manualId, setManualId] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorities, setAuthorities] = useState<Record<string, Authority>>({});

  const selectedId = manualId ?? conversations[0]?.id ?? null;
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const selectedAuth = selected ? authorities[selected.authority] : undefined;
  const rows = useMemo(
    () => (selectedId ? (rowsByConv[selectedId] ?? []) : []),
    [rowsByConv, selectedId],
  );

  // Realtime subscriptions first, then the initial conversation fetch.
  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      queueMicrotask(() => setError((e as Error).message));
      return;
    }

    const channel = supabase
      .channel("audit-panel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_log" },
        (payload) => {
          const row = { ...(payload.new as AuditRow), live: true };
          if (!row.conversation_id) return;
          const cid = row.conversation_id;
          setRowsByConv((prev) => ({
            ...prev,
            [cid]: mergeRows(prev[cid] ?? [], [row]),
          }));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        (payload) => {
          setConversations((prev) =>
            upsertConversation(prev, payload.new as Conversation),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        (payload) => {
          setConversations((prev) =>
            upsertConversation(prev, payload.new as Conversation),
          );
        },
      )
      .subscribe();

    // Country and time zone per authority. Empty or failing: header omits them.
    supabase
      .from("authorities")
      .select("*")
      .then(({ data }) => {
        if (!data) return;
        const next: Record<string, Authority> = {};
        for (const a of data as Authority[]) next[a.id] = a;
        setAuthorities(next);
      });

    supabase
      .from("conversations")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
        } else {
          setConversations((prev) => {
            let next = [...(data as Conversation[])];
            for (const c of prev) next = upsertConversation(next, c);
            return next.sort(byStartedDesc);
          });
        }
        setConvLoaded(true);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Load the audit rows for the selected conversation once.
  useEffect(() => {
    if (!selectedId || loadedConv[selectedId]) return;
    const cid = selectedId;
    getSupabase()
      .from("audit_log")
      .select("*")
      .eq("conversation_id", cid)
      .order("ts", { ascending: false })
      .limit(500)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          return;
        }
        setRowsByConv((prev) => ({
          ...prev,
          [cid]: mergeRows(prev[cid] ?? [], data as AuditRow[]),
        }));
        setLoadedConv((prev) => ({ ...prev, [cid]: true }));
      });
  }, [selectedId, loadedConv]);

  // Clock for the call timer. Starts after mount to avoid hydration mismatch.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  let timer = "--:--";
  if (selected) {
    const start = Date.parse(selected.started_at);
    const end = selected.ended_at ? Date.parse(selected.ended_at) : now;
    if (end !== null) timer = formatDuration(end - start);
  }

  const onPick = (value: string) => {
    setManualId(value === FOLLOW ? null : value);
  };

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.authority}>
          {selected
            ? authorityName(selected.authority, authorities)
            : "Audit panel"}
        </h1>
        {selected && (
          <div className={styles.meta}>
            {selectedAuth && (
              <span className={styles.country} title="Authority country">
                {selectedAuth.country}
              </span>
            )}
            {selectedAuth && now !== null && (
              <span
                className={styles.localTime}
                aria-label={`Local time in ${timezoneCity(selectedAuth.timezone)}`}
              >
                {timezoneCity(selectedAuth.timezone)}{" "}
                {formatClock(now, selectedAuth.timezone)}
              </span>
            )}
            <span className={styles.timer} aria-label="Call duration">
              {timer}
            </span>
            <span>{languageName(selected.language)}</span>
            {selected.verified_at && (
              <span className={styles.verified}>Verified</span>
            )}
            {selected.ended_at ? (
              <span className={styles.ended}>Call ended</span>
            ) : (
              <span className={styles.live}>Live</span>
            )}
          </div>
        )}
      </header>

      <div className={styles.toolbar}>
        <span>
          {manualId ? "Viewing a selected call" : "Following the newest call"}
          {" · "}row times in {ROW_TIME_ZONE_LABEL}
        </span>
        <select
          className={styles.select}
          value={manualId ?? FOLLOW}
          onChange={(e) => onPick(e.target.value)}
          aria-label="Choose a conversation"
        >
          <option value={FOLLOW}>Follow newest</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {`${authorityName(c.authority, authorities)} · ${formatStart(c.started_at)} (UK)`}
            </option>
          ))}
        </select>
      </div>

      {error && <p className={styles.errorText}>Could not load data: {error}</p>}

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyPulse} aria-hidden="true" />
          {convLoaded ? "Waiting for a call" : "Connecting"}
        </div>
      ) : (
        <ol className={styles.list} aria-live="polite">
          {rows.map((r) => (
            <li key={r.id} className={r.live ? styles.rowLive : styles.row}>
              <span className={styles.time} title={ROW_TIME_ZONE_LABEL}>
                {formatTime(r.ts)}
              </span>
              <span
                className={styles.actor}
                style={{ color: ACTOR_COLOURS[r.actor] ?? "#8b98a8" }}
              >
                {r.actor}
              </span>
              <div className={styles.body}>
                <div className={styles.action} dir="auto">
                  {r.action}
                </div>
                {r.data_used && (
                  <div className={styles.dataUsed} dir="auto">
                    {r.data_used}
                  </div>
                )}
                {r.rule_ids && r.rule_ids.length > 0 && (
                  <div className={styles.rules}>
                    {r.rule_ids.map((id) => (
                      <span key={id} className={styles.rule}>
                        {id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span
                className={styles[r.result] ?? styles.ok}
                role="img"
                aria-label={`Result: ${r.result}`}
                title={r.result}
              />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
