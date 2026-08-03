// Viskod Demo — Task Manager client logic

(() => {
  const form = document.getElementById('task-form');
  const taskList = document.getElementById('task-list');
  const feed = document.getElementById('activity-feed');

  function addTask(name, project, priority) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.innerHTML = `
      <span class="task-status active" aria-label="In progress"></span>
      <div class="task-info">
        <span class="task-name">${name}</span>
        <span class="task-meta">${project} · Added just now</span>
      </div>
    `;
    taskList.prepend(li);

    // Add to activity feed
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <div class="activity-avatar" style="background: #3b82f6;">Y</div>
      <div class="activity-content">
        <p><strong>You</strong> created "${name}"</p>
        <time>Just now</time>
      </div>
    `;
    feed.prepend(item);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('task-name').value.trim();
    const project = document.getElementById('task-project').value;
    if (!name) return;
    addTask(name, project);
    form.reset();
  });

  document.getElementById('new-task-btn').addEventListener('click', () => {
    document.getElementById('task-name').focus();
  });
})();
