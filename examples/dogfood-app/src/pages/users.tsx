interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

const USERS: User[] = [
  {
    id: 'u1',
    name: 'John Carter',
    email: 'john.carter@example.com',
    role: 'Admin',
    status: 'Active',
  },
  {
    id: 'u2',
    name: 'Sarah Nguyen',
    email: 'sarah.nguyen@example.com',
    role: 'Editor',
    status: 'Active',
  },
  {
    id: 'u3',
    name: 'Miguel Rodriguez',
    email: 'miguel.rodriguez@example.com',
    role: 'Viewer',
    status: 'Invited',
  },
  {
    id: 'u4',
    name: 'Aisha Patel',
    email: 'aisha.patel@example.com',
    role: 'Editor',
    status: 'Inactive',
  },
  {
    id: 'u5',
    name: 'Tom Becker',
    email: 'tom.becker@example.com',
    role: 'Viewer',
    status: 'Active',
  },
  {
    id: 'u6',
    name: 'Lena Fischer',
    email: 'lena.fischer@example.com',
    role: 'Admin',
    status: 'Active',
  },
  {
    id: 'u7',
    name: 'Omar Haddad',
    email: 'omar.haddad@example.com',
    role: 'Editor',
    status: 'Invited',
  },
];

export function UsersPage() {
  return (
    <div className="page">
      <h1>Users</h1>
      <section className="card" data-slot="card">
        <h2 className="card-title">Team Members</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {USERS.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>{user.status}</td>
                <td>
                  <button type="button" className="row-action">
                    Edit
                  </button>
                  <button type="button" className="row-action">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
