// TargetCard component (source hint fixture)
function TargetCard() {
  return React.createElement(
    'div',
    { className: 'phase12-source-target-card target-card' },
    React.createElement('h2', { className: 'target-card-title' }, 'Phase 12C Source Hint Target'),
    React.createElement(
      'p',
      { className: 'target-card-description' },
      'This card is the target for source hint validation.',
    ),
    React.createElement(
      'button',
      { className: 'target-card-button', id: 'phase12-source-submit-button', type: 'button' },
      'Submit',
    ),
  );
}
