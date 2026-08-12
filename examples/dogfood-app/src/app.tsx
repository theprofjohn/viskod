import { type ReactElement, useEffect, useState } from 'react';
import { IconButton } from './components/icon-button';
import { Sidebar } from './components/sidebar';
import { DashboardPage } from './pages/dashboard';
import { InvoicesPage } from './pages/invoices';
import { OrdersPage } from './pages/orders';
import { SettingsPage } from './pages/settings';
import { TasksPage } from './pages/tasks';
import { UsersPage } from './pages/users';
import './styles.css';

function renderPage(pathname: string): ReactElement {
  switch (pathname) {
    case '/users':
      return <UsersPage />;
    case '/orders':
      return <OrdersPage />;
    case '/tasks':
      return <TasksPage />;
    case '/invoices':
      return <InvoicesPage />;
    case '/settings':
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Viskod Dogfood App</span>
        <IconButton label="Toggle theme" />
      </header>
      <Sidebar />
      <main className="app-main">{renderPage(pathname)}</main>
    </div>
  );
}
