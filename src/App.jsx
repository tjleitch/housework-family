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

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsText(file);
  });
}

function mapBackupTasksToSupabaseRows(parsedJson) {
  let tasks = [];

  // Support v2 backup format:
  // { version, exportedAtISO, state: { tasks: [...] } }
  if (parsedJson?.state?.tasks && Array.isArray(parsedJson.state.tasks)) {
    tasks = parsedJson.state.tasks;
  }
  // Support older/simple format:
  // { tasks: [...] }
  else if (parsedJson?.tasks && Array.isArray(parsedJson.tasks)) {
    tasks = parsedJson.tasks;
  } else {
    throw new Error("Could not find tasks in backup JSON.");
  }

  const rows = tasks
    .map((t) => ({
      name: String(t.name || "").trim(),
      freq_days: Number(t.freqDays),
      last_done: String(t.lastDoneISO || "").trim(),
      est_min: Number(t.estMin),
      updated_at: new Date().toISOString(),
    }))
    .filter(
      (t) =>
        t.name &&
        Number.isFinite(t.freq_days) &&
        t.freq_days >= 1 &&
        /^\d{4}-\d{2}-\d{2}$/.test(t.last_done) &&
        Number.isFinite(t.est_min) &&
        t.est_min >= 1
    );

  if (rows.length === 0) {
    throw new Error("No valid tasks found in backup JSON.");
  }

  return rows;
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  async function loadTasks() {
    setLoading(true);
    setErrorText("");

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("updated_at", { ascending: false });

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

  async function importFromBackupReplaceAll() {
    if (!selectedFile) {
      alert("Please choose a backup JSON file first.");
      return;
    }

    const ok = confirm(
      "This will DELETE all current tasks in the Family app and replace them with the tasks from your backup file. Continue?"
    );
    if (!ok) return;

    setImporting(true);
    setStatusText("");
    setErrorText("");

    try {
      const text = await readFileText(selectedFile);
      const parsed = JSON.parse(text);
      const rows = mapBackupTasksToSupabaseRows(parsed);

      const { error: deleteError } = await supabase
        .from("tasks")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (deleteError) {
        throw new Error(`Delete failed: ${deleteError.message}`);
      }

      const { error: insertError } = await supabase.from("tasks").insert(rows);

      if (insertError) {
        throw new Error(`Insert failed: ${insertError.message}`);
      }

      setStatusText(`Imported ${rows.length} tasks successfully.`);
      setSelectedFile(null);
      await loadTasks();
    } catch (err) {
      setErrorText(err.message || String(err));
    } finally {
      setImporting(false);
    }
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
    <div style={{ maxWidth: 950, margin: "0 auto", padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Housework Family</h1>
      <p>Shared family task list synced through Supabase.</p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 14,
          background: "#f9f9f9",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Import from solo app backup
        </div>

        <div style={{ fontSize: 14, color: "#444", marginBottom: 10 }}>
          Choose the JSON backup file you downloaded from the original single-person app.
          This will replace all tasks currently in the Family app.
        </div>

        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setSelectedFile(f);
          }}
        />

        <div style={{ marginTop: 10 }}>
          <button onClick={importFromBackupReplaceAll} disabled={importing || !selectedFile}>
            {importing ? "Importing..." : "Replace all tasks from backup"}
          </button>
        </div>

        {selectedFile && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>
            Selected file: {selectedFile.name}
          </div>
        )}

        {statusText && (
          <div style={{ marginTop: 10, color: "green", fontSize: 14 }}>{statusText}</div>
        )}
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
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

            <div style={{ marginTop: 6, fontSize: 14 }}>
              {formatStatus(task)}
            </div>

            <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
              Updated at: {formatDateTime(task.updated_at)}
            </div>

            <div style={{ marginTop: 10 }}>
              <button onClick={() => markDone(task)}>Done</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}