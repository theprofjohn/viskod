interface SidebarLink {
  href: string;
  label: string;
}

const LINKS: SidebarLink[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/users', label: 'Users' },
  { href: '/orders', label: 'Orders' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  return (
    <nav className="sidebar" aria-label="Primary">
      <ul className="sidebar-list">
        {LINKS.map((link) => (
          <li key={link.href}>
            <a className="sidebar-link" href={link.href}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
