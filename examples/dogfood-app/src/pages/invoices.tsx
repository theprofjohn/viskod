interface Invoice {
  id: string;
  client: string;
  amount: string;
  paid: string;
}

const INVOICES: Invoice[] = [
  { id: 'INV-301', client: 'Acme Corp', amount: '$1,240.00', paid: 'Paid' },
  { id: 'INV-302', client: 'Globex Inc', amount: '$860.50', paid: 'Pending' },
  { id: 'INV-303', client: 'Initech Ltd', amount: '$3,105.25', paid: 'Paid' },
  { id: 'INV-304', client: 'Umbrella Co', amount: '$220.00', paid: 'Overdue' },
  { id: 'INV-305', client: 'Stark Industries', amount: '$4,800.00', paid: 'Pending' },
  { id: 'INV-306', client: 'Wayne Enterprises', amount: '$1,950.75', paid: 'Paid' },
];

export function InvoicesPage() {
  return (
    <div className="page">
      <h1>Invoices</h1>
      <section className="card" data-slot="card">
        <h2 className="card-title">Invoice List</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.id}</td>
                <td>{invoice.client}</td>
                <td>{invoice.amount}</td>
                <td>{invoice.paid}</td>
                <td>
                  <button type="button" className="row-action">
                    Pay
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
