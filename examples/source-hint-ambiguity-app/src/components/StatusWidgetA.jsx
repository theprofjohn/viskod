// Phase 30 ambiguity fixture — candidate A.
// Contains the SAME visible text as StatusWidgetB.jsx. The target text alone
// cannot distinguish the two files, so source resolution must be ambiguous.
export function StatusWidgetA() {
  return <p className="status-text">Duplicate status text: processing request 42</p>;
}
