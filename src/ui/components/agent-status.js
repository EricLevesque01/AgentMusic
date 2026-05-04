/**
 * TasteGraph — Agent Status Component
 * ChatGPT-style "thinking" display that shows the logical steps
 * agents are making in plain, user-friendly language.
 *
 * Pipeline stages: Profile → Scout → Curate → Explain
 * Each stage has a clear description and streams reasoning steps.
 */

const STAGES = [
  { id: 'profiler',  label: 'Profile',   icon: '🧠', desc: 'Understanding your taste' },
  { id: 'cultural',  label: 'Research',  icon: '🌐', desc: 'Checking what\'s happening in music now' },
  { id: 'scout',     label: 'Scout',     icon: '🔍', desc: 'Finding candidates' },
  { id: 'curator',   label: 'Curate',   icon: '🎵', desc: 'Building your playlist' },
  { id: 'narrator',  label: 'Explain',  icon: '✍️', desc: 'Writing the story' },
];

/**
 * Translate internal agent messages into user-friendly language.
 * The agents emit technical thoughts; we surface only what matters.
 */
function humanizeThought(raw) {
  // Only surface the high-level reasoning moments — skip everything else.
  // Goal: ~1 thought per pipeline stage, max.

  // Sprint 5.3: CulturalScout web research results
  if (/Cultural(Scout|Intel|Intelligence)/i.test(raw)) {
    const cleaned = raw.replace(/^Cultural\w*:\s*/i, '');
    return '🌐 ' + (cleaned.length > 80 ? cleaned.slice(0, 77) + '…' : cleaned);
  }

  // Sprint 5.3: Curator's Selection Thesis (arc/discovery ratio/exclusions)
  if (/Selection Thesis|Curator.*[Tt]hesis|Arc:/i.test(raw)) {
    const cleaned = raw.replace(/^.*[Tt]hesis[:\s]*/i, '');
    return '🎯 ' + (cleaned.length > 90 ? cleaned.slice(0, 87) + '…' : cleaned);
  }

  // Scout's LLM-generated strategy reasoning — this is the interesting one
  if (/Scout strategy/i.test(raw)) {
    const cleaned = raw.replace(/^Scout strategy:\s*/i, '');
    return cleaned.length > 80 ? cleaned.slice(0, 77) + '…' : cleaned;
  }

  // Curator's reflection — the "why" behind the playlist
  if (/Curator Reflection/i.test(raw)) {
    const cleaned = raw.replace(/^Curator Reflection:\s*/i, '');
    return cleaned.length > 90 ? cleaned.slice(0, 87) + '…' : cleaned;
  }

  // Sprint 5.3: Narrator background enrichment completion
  if (/Narrator.*Enrich/i.test(raw)) {
    const count = raw.match(/(\d+)/)?.[1];
    return count ? `✨ Deep-dived ${count} discovery track${count !== '1' ? 's' : ''} with music-history context` : '✨ Discovery tracks enriched';
  }

  // Final result summary
  if (/Final playlist/i.test(raw)) {
    const tracks = raw.match(/(\d+) tracks/)?.[1];
    const artists = raw.match(/(\d+) artists/)?.[1];
    return tracks && artists
      ? `Selected ${tracks} tracks from ${artists} artists`
      : 'Playlist assembled';
  }

  // Everything else is internal plumbing — don't show it
  return null;
}

export class AgentStatus {
  constructor(container) {
    this.container = container;
    this.currentStage = null;
    this.isDone = false;
    this.thoughts = [];    // Humanized thoughts
    this._expanded = true; // Thinking section expanded by default
  }

  update(stageId, isDone = false) {
    this.currentStage = stageId;
    this.isDone = isDone;
    if (isDone) this._expanded = false; // Auto-collapse when done
    this.render();
  }

  addThought(rawThought) {
    const humanized = humanizeThought(rawThought);
    if (!humanized) return; // Skip noisy messages

    // Deduplicate consecutive identical thoughts
    if (this.thoughts.length > 0 && this.thoughts[this.thoughts.length - 1].text === humanized) return;

    this.thoughts.push({
      text: humanized,
      time: Date.now(),
      stage: this.currentStage,
    });

    // Keep last 12 thoughts
    if (this.thoughts.length > 12) this.thoughts.shift();

    this.render();

    // Auto-scroll the thought feed
    requestAnimationFrame(() => {
      const feed = this.container.querySelector('.thinking-feed');
      if (feed) feed.scrollTop = feed.scrollHeight;
    });
  }

  render() {
    const stageIndex = this.isDone
      ? STAGES.length
      : STAGES.findIndex(s => s.id === this.currentStage);

    const activeStage = STAGES[stageIndex] || STAGES[0];

    // Pipeline progress dots
    const pipelineHtml = STAGES.map((stage, i) => {
      const isPast = i < stageIndex || this.isDone;
      const isActive = i === stageIndex && !this.isDone;

      return `
        <div class="pipeline-step ${isPast ? 'done' : ''} ${isActive ? 'active' : ''}">
          <div class="pipeline-dot ${isPast ? 'done' : ''} ${isActive ? 'active' : ''}">
            ${isPast ? '✓' : stage.icon}
          </div>
          <span class="pipeline-label">${stage.label}</span>
        </div>
        ${i < STAGES.length - 1 ? `<div class="pipeline-connector ${isPast ? 'done' : ''} ${isActive ? 'active' : ''}"></div>` : ''}
      `;
    }).join('');

    // Status summary line
    const statusText = this.isDone
      ? 'Done — your playlist is ready'
      : activeStage?.desc || 'Starting…';

    // Thinking feed (ChatGPT-style)
    const thoughtsHtml = this.thoughts.length > 0 ? `
      <div class="thinking-section ${this._expanded ? 'expanded' : 'collapsed'}">
        <button class="thinking-toggle" aria-expanded="${this._expanded}">
          <span class="thinking-toggle-icon">${this._expanded ? '▾' : '▸'}</span>
          <span class="thinking-toggle-label">
            ${this.isDone ? 'Show reasoning' : 'Thinking…'}
          </span>
          ${!this.isDone ? '<span class="thinking-pulse"></span>' : ''}
        </button>
        ${this._expanded ? `
          <div class="thinking-feed">
            ${this.thoughts.map((t, i) => {
              const isLatest = i === this.thoughts.length - 1 && !this.isDone;
              const stageInfo = STAGES.find(s => s.id === t.stage);
              return `
                <div class="thinking-step ${isLatest ? 'latest' : ''}">
                  <span class="thinking-step-icon">${stageInfo?.icon || '•'}</span>
                  <span class="thinking-step-text">${t.text}</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    ` : '';

    this.container.innerHTML = `
      <div class="agent-status-panel">
        <div class="pipeline-progress">
          ${pipelineHtml}
        </div>
        <div class="status-summary ${this.isDone ? 'done' : 'active'}">
          ${statusText}
        </div>
        ${thoughtsHtml}
      </div>
    `;

    // Toggle handler
    const toggle = this.container.querySelector('.thinking-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        this._expanded = !this._expanded;
        this.render();
      });
    }
  }
}
