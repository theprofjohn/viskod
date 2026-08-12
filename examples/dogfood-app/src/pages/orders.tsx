interface Order {
  id: string;
  customer: string;
  status: string;
  total: string;
}

const ORDERS: Order[] = [
  { id: 'ORD-2001', customer: 'Acme Corp', status: 'Shipped', total: '$1,240.00' },
  { id: 'ORD-2002', customer: 'Globex Inc', status: 'Processing', total: '$860.50' },
  { id: 'ORD-2003', customer: 'Initech Ltd', status: 'Delivered', total: '$3,105.25' },
  { id: 'ORD-2004', customer: 'Umbrella Co', status: 'Cancelled', total: '$220.00' },
  { id: 'ORD-2005', customer: 'Stark Industries', status: 'Shipped', total: '$4,800.00' },
  { id: 'ORD-2006', customer: 'Wayne Enterprises', status: 'Processing', total: '$1,950.75' },
];

export function OrdersPage() {
  return (
    <div className="page">
      <h1>Orders</h1>
      <section className="card" data-slot="card">
        <h2 className="card-title">All Orders</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ORDERS.map((order) => (
              <tr key={order.id}>
                <td>{order.id}</td>
                <td>{order.customer}</td>
                <td>{order.status}</td>
                <td>{order.total}</td>
                <td>
                  <button type="button" className="row-action">
                    View
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
