const stageData = [
  {
    title: 'Report UI issue',
    copy: 'Point at the element that looks wrong.',
    target: 'button.fake-action',
    evidence: ['Screenshot + bounds', 'DOM + computed styles', 'Source hints · 86% confidence'],
    width: '28%',
  },
  {
    title: 'Handoff ready',
    copy: 'Give your agent the evidence behind the bug.',
    target: 'button.fake-action',
    evidence: [
      'Problem + expected result',
      'Context packet · pkt_8f31',
      'Source hints · 86% confidence',
    ],
    width: '64%',
  },
  {
    title: 'Verify the fix',
    copy: 'Compare the same target before and after.',
    target: 'button.fake-action',
    evidence: ['Before + after capture', 'Same target · confidence 94%', 'Human decision required'],
    width: '100%',
  },
];

const stageButtons = [...document.querySelectorAll('[data-demo-stage]')];
const workflowTabs = [...document.querySelectorAll('[data-workflow-tab]')];
const workflowPanels = [...document.querySelectorAll('[data-workflow-panel]')];
const stageTitle = document.querySelector('#hero-stage-title');
const stageCopy = document.querySelector('#hero-stage-copy');
const stageTarget = document.querySelector('#hero-target');
const evidenceLines = [
  document.querySelector('#hero-evidence-one'),
  document.querySelector('#hero-evidence-two'),
  document.querySelector('#hero-evidence-three'),
];
const progressFill = document.querySelector('.progress-fill');
const nextButton = document.querySelector('[data-demo-next]');
const playButton = document.querySelector('[data-demo-play]');
let currentStage = 0;
let playTimer;

function setDemoStage(nextStage) {
  currentStage = (nextStage + stageData.length) % stageData.length;
  const data = stageData[currentStage];
  for (const button of stageButtons) {
    const isActive = Number(button.dataset.demoStage) === currentStage;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-current', isActive ? 'step' : 'false');
  }
  if (stageTitle) stageTitle.textContent = data.title;
  if (stageCopy) stageCopy.textContent = data.copy;
  if (stageTarget) stageTarget.textContent = data.target;
  evidenceLines.forEach((line, index) => {
    if (line) line.textContent = data.evidence[index];
  });
  if (progressFill) progressFill.style.width = data.width;
}

function setWorkflowTab(nextTab) {
  for (const tab of workflowTabs) {
    const isActive = Number(tab.dataset.workflowTab) === nextTab;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  }
  for (const panel of workflowPanels) {
    const isActive = Number(panel.dataset.workflowPanel) === nextTab;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  }
}

for (const button of stageButtons) {
  button.addEventListener('click', () => setDemoStage(Number(button.dataset.demoStage)));
}

if (nextButton) {
  nextButton.addEventListener('click', () => setDemoStage(currentStage + 1));
}

for (const tab of workflowTabs) {
  tab.addEventListener('click', () => setWorkflowTab(Number(tab.dataset.workflowTab)));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = Number(tab.dataset.workflowTab);
    const nextIndex =
      event.key === 'ArrowUp'
        ? (index + 2) % 3
        : event.key === 'ArrowDown'
          ? (index + 1) % 3
          : event.key === 'Home'
            ? 0
            : 2;
    setWorkflowTab(nextIndex);
    workflowTabs[nextIndex]?.focus();
  });
}

if (playButton) {
  playButton.addEventListener('click', () => {
    const isPlaying = playButton.getAttribute('aria-pressed') === 'true';
    if (isPlaying) {
      window.clearInterval(playTimer);
      playButton.setAttribute('aria-pressed', 'false');
      playButton.innerHTML = '<span aria-hidden="true">▶</span> Play walkthrough';
      return;
    }
    playButton.setAttribute('aria-pressed', 'true');
    playButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause walkthrough';
    setDemoStage(currentStage + 1);
    playTimer = window.setInterval(() => setDemoStage(currentStage + 1), 2200);
  });
}

for (const button of document.querySelectorAll('[data-copy-command]')) {
  button.addEventListener('click', async () => {
    const command = button.dataset.copyCommand;
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      const original = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = original;
      }, 1600);
    } catch {
      button.textContent = 'Select manually';
      window.setTimeout(() => {
        button.textContent = 'Copy';
      }, 1600);
    }
  });
}

const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('#mobile-menu');
if (menuToggle && mobileMenu) {
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    mobileMenu.classList.toggle('open', !isOpen);
  });
  for (const link of mobileMenu.querySelectorAll('a')) {
    link.addEventListener('click', () => {
      menuToggle.setAttribute('aria-expanded', 'false');
      mobileMenu.classList.remove('open');
    });
  }
}

setDemoStage(0);
setWorkflowTab(0);
