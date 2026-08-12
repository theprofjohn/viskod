import { Card } from '../components/card';

interface RecentOrder {
  id: string;
  customer: string;
  status: string;
  amount: string;
}

const RECENT_ORDERS: RecentOrder[] = [
  { id: 'ORD-1042', customer: 'Alice Johnson', status: 'Completed', amount: '$120.00' },
  { id: 'ORD-1043', customer: 'Ben Carter', status: 'Processing', amount: '$85.50' },
  { id: 'ORD-1044', customer: 'Carla Gomez', status: 'Shipped', amount: '$210.00' },
  { id: 'ORD-1045', customer: 'Daniel Kim', status: 'Completed', amount: '$45.25' },
  { id: 'ORD-1046', customer: 'Elena Rossi', status: 'Delivered', amount: '$310.75' },
  { id: 'ORD-1047', customer: 'Frank Muller', status: 'Processing', amount: '$92.00' },
  { id: 'ORD-1048', customer: 'Grace Chen', status: 'Completed', amount: '$154.40' },
  { id: 'ORD-1049', customer: 'Hassan Ali', status: 'Cancelled', amount: '$67.90' },
  { id: 'ORD-1050', customer: 'Ivy Patel', status: 'Shipped', amount: '$238.10' },
  { id: 'ORD-1051', customer: 'Jack Wilson', status: 'Completed', amount: '$76.00' },
  { id: 'ORD-1052', customer: 'Kate Novak', status: 'Refunded', amount: '$198.60' },
  { id: 'ORD-1053', customer: 'Liam OConnor', status: 'Processing', amount: '$54.30' },
  { id: 'ORD-1054', customer: 'Maya Singh', status: 'Delivered', amount: '$421.00' },
  { id: 'ORD-1055', customer: 'Noah Brown', status: 'Completed', amount: '$99.99' },
  { id: 'ORD-1056', customer: 'Olivia Davis', status: 'Shipped', amount: '$187.75' },
  { id: 'ORD-1057', customer: 'Peter Zhang', status: 'Processing', amount: '$64.50' },
];

export function DashboardPage() {
  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="cards">
        <Card title="Total Revenue" value="$45.2k revenue" />
        <Card title="Active Users" value="2.3k members" />
        <Card title="New Orders" value="1.2k today" />
      </div>
      <section className="card" data-slot="card">
        <div className="card-header">
          <h2 className="card-title">Recent Orders</h2>
          <button type="button" className="more-button" aria-label="More options">
            ⋯
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer&nbsp;</th>
              <th>Order Number&nbsp;</th>
              <th>Status&nbsp;</th>
              <th>Amount&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {RECENT_ORDERS.map((order) => (
              <tr key={order.id}>
                <td>{order.customer}</td>
                <td>{order.id}</td>
                <td>{order.status}</td>
                <td>{order.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="page-spacer" aria-hidden="true" />
    </div>
  );
}
