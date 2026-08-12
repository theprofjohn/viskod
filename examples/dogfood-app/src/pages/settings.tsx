export function SettingsPage() {
  return (
    <div className="page">
      <h1>Settings</h1>
      <section className="card" data-slot="card">
        <h2 className="card-title">General Settings</h2>
        <label className="field-label" htmlFor="search-input">
          Search
        </label>
        <input id="search-input" className="text-input" placeholder="Search..." type="search" />
        <label className="field-label" htmlFor="status-select">
          Status
        </label>
        <select id="status-select" className="text-input">
          <option>Select status</option>
          <option>Active</option>
          <option>Inactive</option>
        </select>
        <label className="checkbox-row">
          <input type="checkbox" />
          Enable notifications
        </label>
        <button type="button" className="save-button">
          Save changes
        </button>
      </section>
    </div>
  );
}
