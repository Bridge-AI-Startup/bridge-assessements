// Wire the board to the API. Markup contract: placeholders "Task title" /
// "Owner", button "Add task", <li> rows with Start (todo) / Finish (doing).

const messageEl = document.getElementById("message");

function showMessage(text) {
  messageEl.textContent = text;
  if (text) {
    clearTimeout(showMessage._t);
    showMessage._t = setTimeout(() => {
      messageEl.textContent = "";
    }, 4000);
  }
}

function taskRow(task) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = task.owner ? `${task.title} — ${task.owner}` : task.title;
  li.appendChild(label);

  if (task.blocked) {
    const flag = document.createElement("em");
    flag.textContent = task.blockedReason
      ? ` (blocked: ${task.blockedReason})`
      : " (blocked)";
    li.appendChild(flag);
  }

  if (task.status === "todo") {
    li.appendChild(actionButton("Start", task.ref, { status: "doing" }));
  } else if (task.status === "doing") {
    li.appendChild(actionButton("Finish", task.ref, { status: "done" }));
  }
  return li;
}

function actionButton(name, ref, patch) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = name;
  btn.addEventListener("click", async () => {
    const res = await fetch(`/api/tasks/ref/${encodeURIComponent(ref)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      showMessage(body.error === "doing_full" ? "Doing is full" : "That move is blocked");
    } else {
      showMessage("");
    }
    await loadTasks();
  });
  return btn;
}

async function loadTasks() {
  const res = await fetch("/api/tasks");
  const { tasks } = await res.json();
  for (const column of ["todo", "doing", "done"]) {
    const ul = document.getElementById(column);
    ul.innerHTML = "";
    for (const task of tasks.filter((t) => t.status === column)) {
      ul.appendChild(taskRow(task));
    }
  }
}

document.getElementById("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const [titleInput, ownerInput] = event.target.querySelectorAll("input");
  const title = titleInput.value.trim();
  if (!title) return;
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, owner: ownerInput.value.trim() || undefined }),
  });
  if (res.ok) {
    titleInput.value = "";
    ownerInput.value = "";
    showMessage("");
    await loadTasks();
  } else {
    const body = await res.json().catch(() => ({}));
    showMessage(body.error || "Could not add task");
  }
});

loadTasks();
