interface Task {
  id: string;
  title: string;
  assignee: string;
  priority: string;
  due: string;
}

const TASKS: Task[] = [
  {
    id: 't1',
    title: 'Design landing page',
    assignee: 'Sarah Nguyen',
    priority: 'High',
    due: '2026-08-15',
  },
  {
    id: 't2',
    title: 'Fix checkout flow',
    assignee: 'John Carter',
    priority: 'High',
    due: '2026-08-14',
  },
  {
    id: 't3',
    title: 'Write API docs',
    assignee: 'Aisha Patel',
    priority: 'Medium',
    due: '2026-08-20',
  },
  {
    id: 't4',
    title: 'Audit permissions',
    assignee: 'Tom Becker',
    priority: 'Low',
    due: '2026-08-28',
  },
  {
    id: 't5',
    title: 'Migrate database',
    assignee: 'Lena Fischer',
    priority: 'High',
    due: '2026-08-18',
  },
  {
    id: 't6',
    title: 'Update pricing page',
    assignee: 'Omar Haddad',
    priority: 'Medium',
    due: '2026-08-22',
  },
];

export function TasksPage() {
  return (
    <div className="page">
      <h1>Tasks</h1>
      <section className="card" data-slot="card">
        <h2 className="card-title">Task List</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Assignee</th>
              <th>Priority</th>
              <th>Due Date</th>
            </tr>
          </thead>
          <tbody>
            {TASKS.map((task) => (
              <tr key={task.id}>
                <td>{task.title}</td>
                <td>{task.assignee}</td>
                <td>{task.priority}</td>
                <td>{task.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
