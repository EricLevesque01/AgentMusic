/**
 * TasteGraph — Agent Status Component
 * Visualizes the pipeline progress.
 */

const STAGES = [
  { id: 'profiler', label: 'Profile' },
  { id: 'scout',    label: 'Scout' },
  { id: 'curator',  label: 'Curate' },
  { id: 'narrator', label: 'Explain' }
];

export class AgentStatus {
  constructor(container) {
    this.container = container;
    this.currentStage = null;
    this.isDone = false;
  }

  update(stageId, isDone = false) {
    this.currentStage = stageId;
    this.isDone = isDone;
    this.render();
  }

  render() {
    let stageIndex = STAGES.findIndex(s => s.id === this.currentStage);
    if (this.isDone) stageIndex = STAGES.length;

    const pipelineHtml = STAGES.map((stage, i) => {
      const isPast = i < stageIndex;
      const isActive = i === stageIndex && !this.isDone;
      
      let dotClass = 'pipeline-dot';
      if (isPast || this.isDone) dotClass += ' done';
      else if (isActive) dotClass += ' active';

      let connectorHtml = '';
      if (i < STAGES.length - 1) {
        let connClass = 'pipeline-connector';
        if (isPast) connClass += ' done';
        else if (isActive) connClass += ' active';
        connectorHtml = `<div class="${connClass}"></div>`;
      }

      return `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 2;">
          <div class="${dotClass}"></div>
          <span style="font-size: 10px; color: ${isActive || isPast || this.isDone ? 'var(--text-primary)' : 'var(--text-muted)'}; font-weight: ${isActive ? 'bold' : 'normal'};">
            ${stage.label}
          </span>
        </div>
        ${connectorHtml}
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="pipeline-status" style="margin-bottom: var(--space-4);">
        <div style="display: flex; align-items: center; width: 100%; position: relative; padding: 0 var(--space-2);">
          ${pipelineHtml}
        </div>
      </div>
    `;
  }
}
