import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const FAMILY_MEMBERS = ["Mommy", "Daddy", "James", "Peter", "Tommy"];
const USER_STORAGE_KEY = "housework_family_current_user";

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

function isDoneToday(task) {
  return task.last_done === todayISO();
}

function isDueOrOverdue(task) {
  return computeDueISO(task) <= todayISO();
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

  if (parsedJson?.state?.tasks && Array.isArray(parsedJson.state.tasks)) {
    tasks = parsedJson.state.tasks;
  } else if (parsedJson?.tasks && Array.isArray(parsedJson.tasks)) {
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
      last_done_by: "",
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

function emptyTaskForm() {
  return {
    name: "",
    freq_days: "7",
    last_done: todayISO(),
    est_min: "15",
  };
}

function validateTaskForm(form) {
  const name = String(form.name || "").trim();
  const freqDays = Number(form.freq_days);
  const lastDone = String(form.last_done || "").trim();
  const estMin = Number(form.est_min);

  if (!name) return "Please enter a task name.";
  if (!Number.isFinite(freqDays) || freqDays < 1) return "Frequency must be at least 1 day.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDone)) return "Last done date must be in YYYY-MM-DD format.";
  if (!Number.isFinite(estMin) || estMin < 1) return "Estimated minutes must be at least 1.";

  return null;
}

function Card({ children, style = {} }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 14,
        background: "#fff",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Button({ children, onClick, disabled = false, kind = "default", type = "button" }) {
  const bg =
    kind === "primary" ? "#111" :
    kind === "danger" ? "#b00020" :
    "#f3f3f3";
  const color = kind === "primary" || kind === "danger" ? "#fff" : "#111";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid #ddd",
        background: disabled ? "#eee" : bg,
        color: disabled ? "#777" : color,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 999,
        border: "1px solid #ddd",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#444" }}>{label}</div>
      {children}
    </label>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      style={{
        padding: 10,
        borderRadius: 10,
        border: "1px solid #ddd",
        background: "#fff",
        width: "100%",
      }}
    />
  );
}

function Select(props) {
  return (
    <select
      {...props}
      style={{
        padding: 10,
        borderRadius: 10,
        border: "1px solid #ddd",
        background: "#fff",
        width: "100%",
      }}
    />
  );
}

function TaskModal({ open, mode, form, setForm, onClose, onSave, onDelete, saving }) {
  if (!open) return null;

  const title = mode === "edit" ? "Edit Task" : "Add Task";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #ddd",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <Field label="Task name">
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Vacuum downstairs"
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Frequency (days)">
              <Input
                type="number"
                min="1"
                value={form.freq_days}
                onChange={(e) => setForm((prev) => ({ ...prev, freq_days: e.target.value }))}
              />
            </Field>

            <Field label="Estimated minutes">
              <Input
                type="number"
                min="1"
                value={form.est_min}
                onChange={(e) => setForm((prev) => ({ ...prev, est_min: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Last done date">
            <Input
              type="date"
              value={form.last_done}
              onChange={(e) => setForm((prev) => ({ ...prev, last_done: e.target.value }))}
            />
          </Field>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            <Button kind="primary" onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>

            {mode === "edit" && (
              <Button kind="danger" onClick={onDelete} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, onDone, onEdit }) {
  const doneToday = isDoneToday(task);

  return (
    <Card
      style={{
        position: "relative",
        overflow: "hidden",
        opacity: doneToday ? 0.88 : 1,
      }}
    >
     {doneToday && (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none",
      fontSize: "clamp(72px, 14vw, 140px)",
      fontWeight: 900,
      transform: "rotate(-12deg)",
      letterSpacing: 6,
      lineHeight: 1,
      userSelect: "none",

      // 👇 conditional styling
      ...(task.last_done_by === "Tommy"
        ? {
            background: `repeating-linear-gradient(
              45deg,
              orange,
              orange 20px,
              black 20px,
              black 40px
            )`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            opacity: 0.35,
          }
        : {
            color: "rgba(200, 0, 0, 0.18)",
          }),
    }}
  >
    DONE
  </div>
)}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 260 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{task.name}</div>

          <div style={{ marginTop: 6, fontSize: 14, color: "#444" }}>
            Every {task.freq_days}d · Last done {task.last_done} · Est {task.est_min} min
          </div>

          <div style={{ marginTop: 6, fontSize: 14 }}>
            {doneToday ? "Done today" : formatStatus(task)}
          </div>

          <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
            Last done by: {task.last_done_by || "—"}
          </div>

          <div style={{ marginTop: 4, fontSize: 13, color: "#666" }}>
            Updated at: {formatDateTime(task.updated_at)}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button kind="primary" onClick={() => onDone(task)}>Done</Button>
          <Button onClick={() => onEdit(task)}>Edit</Button>
        </div>
      </div>
    </Card>
  );
}

export default function App() {
  const [tab, setTab] = useState("today");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem(USER_STORAGE_KEY) || "Daddy";
  });

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState("add");
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm, setTaskForm] = useState(emptyTaskForm());
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => {
    localStorage.setItem(USER_STORAGE_KEY, currentUser);
  }, [currentUser]);

  async function loadTasks() {
    setLoading(true);
    setErrorText("");

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("name", { ascending: true });

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
        last_done_by: currentUser,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .select();

    if (error) {
      alert(`Failed to mark done: ${error.message}`);
      return;
    }

    setStatusText(`Marked "${task.name}" done as ${currentUser}.`);
    await loadTasks();
  }

  function openAddTask() {
    setTaskModalMode("add");
    setEditingTask(null);
    setTaskForm(emptyTaskForm());
    setTaskModalOpen(true);
  }

  function openEditTask(task) {
    setTaskModalMode("edit");
    setEditingTask(task);
    setTaskForm({
      name: task.name ?? "",
      freq_days: String(task.freq_days ?? 7),
      last_done: task.last_done ?? todayISO(),
      est_min: String(task.est_min ?? 15),
    });
    setTaskModalOpen(true);
  }

  async function saveTask() {
    const validationError = validateTaskForm(taskForm);
    if (validationError) {
      alert(validationError);
      return;
    }

    setSavingTask(true);
    setErrorText("");
    setStatusText("");

    const row = {
      name: String(taskForm.name).trim(),
      freq_days: Number(taskForm.freq_days),
      last_done: String(taskForm.last_done).trim(),
      est_min: Number(taskForm.est_min),
      updated_at: new Date().toISOString(),
    };

    try {
      if (taskModalMode === "add") {
        const { error } = await supabase.from("tasks").insert({
          ...row,
          last_done_by: "",
        });
        if (error) throw error;
        setStatusText(`Added "${row.name}".`);
      } else {
        const { error } = await supabase
          .from("tasks")
          .update(row)
          .eq("id", editingTask.id);
        if (error) throw error;
        setStatusText(`Updated "${row.name}".`);
      }

      setTaskModalOpen(false);
      setEditingTask(null);
      setTaskForm(emptyTaskForm());
      await loadTasks();
    } catch (err) {
      setErrorText(err.message || String(err));
    } finally {
      setSavingTask(false);
    }
  }

  async function deleteTask() {
    if (!editingTask) return;

    const ok = confirm(`Delete "${editingTask.name}"?`);
    if (!ok) return;

    setSavingTask(true);
    setErrorText("");
    setStatusText("");

    try {
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", editingTask.id);

      if (error) throw error;

      setStatusText(`Deleted "${editingTask.name}".`);
      setTaskModalOpen(false);
      setEditingTask(null);
      setTaskForm(emptyTaskForm());
      await loadTasks();
    } catch (err) {
      setErrorText(err.message || String(err));
    } finally {
      setSavingTask(false);
    }
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

  const allTasksSorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const aDue = computeDueISO(a);
      const bDue = computeDueISO(b);
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      return a.name.localeCompare(b.name);
    });
  }, [tasks]);

  const todayTasks = useMemo(() => {
    return [...tasks]
      .filter((task) => isDueOrOverdue(task) || isDoneToday(task))
      .sort((a, b) => {
        const aDone = isDoneToday(a);
        const bDone = isDoneToday(b);

        if (aDone !== bDone) return aDone ? -1 : 1;

        const aDue = computeDueISO(a);
        const bDue = computeDueISO(b);
        if (aDue !== bDue) return aDue.localeCompare(bDue);

        return a.name.localeCompare(b.name);
      });
  }, [tasks]);

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

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Who am I on this device?</div>
          <div style={{ maxWidth: 280 }}>
            <Field label="Current user">
              <Select
                value={currentUser}
                onChange={(e) => setCurrentUser(e.target.value)}
              >
                {FAMILY_MEMBERS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ fontSize: 13, color: "#666" }}>
            This choice is saved on this device and will be used when you tap Done.
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <TabButton active={tab === "today"} onClick={() => setTab("today")}>
          Today
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All Tasks
        </TabButton>
      </div>

      {tab === "all" && (
        <>
          <Card style={{ marginBottom: 14 }}>
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
              <Button onClick={importFromBackupReplaceAll} disabled={importing || !selectedFile}>
                {importing ? "Importing..." : "Replace all tasks from backup"}
              </Button>
            </div>

            {selectedFile && (
              <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>
                Selected file: {selectedFile.name}
              </div>
            )}
          </Card>
        </>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Button kind="primary" onClick={openAddTask}>+ Add Task</Button>
        <Button onClick={loadTasks}>Refresh</Button>
      </div>

      {statusText && (
        <div style={{ marginBottom: 12, color: "green", fontSize: 14 }}>{statusText}</div>
      )}

      {loading && <p>Loading tasks...</p>}
      {errorText && <p style={{ color: "crimson" }}>{errorText}</p>}

      {!loading && !errorText && tab === "today" && todayTasks.length === 0 && (
        <p>Nothing due today. Nice work.</p>
      )}

      {!loading && !errorText && tab === "all" && allTasksSorted.length === 0 && (
        <p>No tasks found.</p>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {!loading && !errorText && tab === "today" &&
          todayTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onDone={markDone}
              onEdit={openEditTask}
            />
          ))}

        {!loading && !errorText && tab === "all" &&
          allTasksSorted.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onDone={markDone}
              onEdit={openEditTask}
            />
          ))}
      </div>

      <TaskModal
        open={taskModalOpen}
        mode={taskModalMode}
        form={taskForm}
        setForm={setTaskForm}
        onClose={() => {
          if (savingTask) return;
          setTaskModalOpen(false);
          setEditingTask(null);
        }}
        onSave={saveTask}
        onDelete={deleteTask}
        saving={savingTask}
      />
    </div>
  );
}