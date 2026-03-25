import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function daysBetweenISO(aISO, bISO) {
  const [ay, am, ad] = aISO.split("-").map(Number);
  const [by, bm, bd] = bISO.split("-").map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function computeDueISO(task) {
  return addDaysISO(task.last_done, Math.max(1, task.freq_days));
}

function formatStatus(task) {
  const today = todayISO();
  const due = computeDueISO(task);
  const delta = daysBetweenISO(due, today);

  if (delta > 0) return `Overdue by ${delta}d`;
  if (delta === 0) return "Due today";
  return `Due in ${Math.abs(delta)}d`;
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  async function loadTasks() {
    setLoading(true);
    setErrorText("");

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("last_done", { ascending: true });

    if (error) {
      setErrorText(error.message);
      setLoading(false);
      return;
    }

    setTasks(data || []);
    setLoading(false);
  }

  async function markDone(task) {
    const today = todayISO();

    const { error } = await supabase
      .from("tasks")
      .update({
        last_done: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .select();

    if (error) {
      alert(`Failed to mark done: ${error.message}`);
      return;
    }

    await loadTasks();
  }

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("tasks-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => {
          loadTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Housework Family</h1>
      <p>Shared family task list synced through Supabase.</p>

      <div style={{ marginBottom: 16 }}>
        <button onClick={loadTasks}>Refresh</button>
      </div>

      {loading && <p>Loading tasks...</p>}
      {errorText && <p style={{ color: "crimson" }}>{errorText}</p>}

      {!loading && !errorText && tasks.length === 0 && <p>No tasks found.</p>}

      <div style={{ display: "grid", gap: 12 }}>
        {tasks.map((task) => (
          <div
            key={task.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>{task.name}</div>
            <div style={{ marginTop: 6, fontSize: 14, color: "#444" }}>
              Every {task.freq_days}d · Last done {task.last_done} · Est {task.est_min} min
            </div>
            <div style={{ marginTop: 6, fontSize: 14 }}>{formatStatus(task)}</div>
            <div style={{ marginTop: 10 }}>
              <button onClick={() => markDone(task)}>Done</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}