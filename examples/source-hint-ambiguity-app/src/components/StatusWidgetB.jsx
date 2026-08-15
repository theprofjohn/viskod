// Phase 30 ambiguity fixture — candidate B.
// Contains the SAME visible text as StatusWidgetA.jsx. The target text alone
// cannot distinguish the two files, so source resolution must be ambiguous.
export function StatusWidgetB() {
  return <p className="status-text">Duplicate status text: processing request 42</p>;
}
