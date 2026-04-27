/**
 * TasteGraph — Overview / Home Page
 * "Deep Space Pro" command center — agent status dashboard.
 */
export function renderHomePage(container) {
  container.innerHTML = `
    <div class="page" id="page-home">

      <!-- Page Header -->
      <div class="page-header flex justify-between items-center">
        <div>
          <h1 class="page-title">
            <span class="page-title-accent">TasteGraph</span>
          </h1>
          <p class="page-subtitle text-upper">Agentic Music Discovery Engine · v2.0</p>
        </div>
        <div style="display:flex;gap:var(--space-3);">
          <button class="btn btn-primary" onclick="location.hash='#/game'">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="4" cy="8" r="3"/><circle cx="12" cy="8" r="3"/>
              <path d="M7 8h2"/>
            </svg>
            Compare
          </button>
          <button class="btn btn-secondary" onclick="location.hash='#/playlist'">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 4h12M2 8h8M2 12h5"/>
              <circle cx="13" cy="11" r="2"/>
              <path d="M13 9V5l2 1"/>
            </svg>
            Generate
          </button>
        </div>
      </div>

      <!-- Agent Grid -->
      <div class="section">
        <div class="section-label">Agent Crew</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--space-3);">
          ${AGENTS.map(a => agentCard(a)).join('')}
        </div>
      </div>

      <!-- System Status -->
      <div class="section">
        <div class="section-label">Pipeline Status</div>
        <div class="pro-panel" style="padding:var(--space-5);">
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
            <div class="pipeline-status" style="flex:1;">
              <div class="pipeline-dot done" title="Profiler"></div>
              <div class="pipeline-connector done"></div>
              <div class="pipeline-dot done" title="Scout"></div>
              <div class="pipeline-connector"></div>
              <div class="pipeline-dot" title="Curator"></div>
              <div class="pipeline-connector"></div>
              <div class="pipeline-dot" title="Narrator"></div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);">
            ${['Profiler','Scout','Curator','Narrator'].map((name, i) => `
              <div style="text-align:center;">
                <div style="font-size:var(--font-size-2xs);text-transform:uppercase;letter-spacing:0.1em;color:${i < 2 ? 'var(--accent-green)' : 'var(--text-muted)'};">${i < 2 ? '● Done' : '○ Idle'}</div>
                <div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-top:2px;">${name}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Quick Stats -->
      <div class="section">
        <div class="section-label">Quick Actions</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
          <div class="glass-card" style="padding:var(--space-5);cursor:pointer;" onclick="location.hash='#/profile'">
            <div style="font-size:var(--font-size-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-2);">Taste Identity</div>
            <div style="font-size:var(--font-size-xl);font-weight:var(--font-weight-bold);color:var(--text-bright);">View Profile →</div>
            <div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-top:var(--space-2);">Genre radar · Tier list · Leaderboard</div>
          </div>
          <div class="glass-card" style="padding:var(--space-5);cursor:pointer;" onclick="location.hash='#/game'">
            <div style="font-size:var(--font-size-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-2);">Ranking Engine</div>
            <div style="font-size:var(--font-size-xl);font-weight:var(--font-weight-bold);color:var(--text-bright);">Compare Artists →</div>
            <div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-top:var(--space-2);">Elo calibration · Coverage gaps · Drift</div>
          </div>
        </div>
      </div>

    </div>
  `;
}

const AGENTS = [
  {
    id: 'profiler', name: 'Profiler', status: 'ready',
    role: 'Builds taste identity from Spotify data + Elo rankings.',
    accent: 'var(--accent-primary)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="5" r="3"/><path d="M1 14c0-3.314 3.134-6 7-6s7 2.686 7 6"/>
    </svg>`,
  },
  {
    id: 'scout', name: 'Scout', status: 'ready',
    role: 'Traverses the music graph to surface discovery candidates.',
    accent: 'var(--accent-cyan)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6.5" cy="6.5" r="4.5"/><path d="M11 11l3 3"/>
    </svg>`,
  },
  {
    id: 'curator', name: 'Curator', status: 'idle',
    role: 'Scores and ranks tracks via LLM + multi-weight signals.',
    accent: 'var(--accent-violet)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 4h12M2 8h8M2 12h5"/><circle cx="13" cy="11" r="2"/>
    </svg>`,
  },
  {
    id: 'narrator', name: 'Narrator', status: 'idle',
    role: 'Generates explainable, personalized track rationales.',
    accent: 'var(--accent-amber)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 2h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1z"/>
    </svg>`,
  },
  {
    id: 'dj', name: 'Session DJ', status: 'listening',
    role: 'Monitors real-time feedback and adapts playlist on the fly.',
    accent: 'var(--accent-green)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="5" cy="12" r="2"/><circle cx="12" cy="10" r="2"/>
      <path d="M7 12V4l7-2v8"/>
    </svg>`,
  },
  {
    id: 'concierge', name: 'Concierge', status: 'idle',
    role: 'Natural language control — chat to reshape your discovery.',
    accent: 'var(--accent-pink)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="12" height="10" rx="1.5"/>
      <path d="M5 15l3-3 3 3"/>
      <path d="M5 7h6M5 9.5h4"/>
    </svg>`,
  },
];

const STATUS_CONFIG = {
  ready:     { color: 'var(--accent-green)',   label: 'Ready' },
  idle:      { color: 'var(--text-muted)',      label: 'Idle' },
  active:    { color: 'var(--accent-primary)',  label: 'Active' },
  listening: { color: 'var(--accent-amber)',    label: 'Listening' },
};

function agentCard({ id, name, role, accent, icon, status }) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  return `
    <div class="glass-card glow" style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-3);">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="width:32px;height:32px;border-radius:var(--radius-md);
                    background:${accent}1a;border:1px solid ${accent}33;
                    display:flex;align-items:center;justify-content:center;
                    color:${accent};flex-shrink:0;">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            ${icon.replace(/<svg[^>]*>|<\/svg>/g, '')}
          </svg>
        </div>
        <span class="badge" style="background:${s.color}18;color:${s.color};border-color:${s.color}30;">
          ${s.label}
        </span>
      </div>
      <div>
        <div style="font-weight:var(--font-weight-semibold);font-size:var(--font-size-sm);color:var(--text-bright);margin-bottom:4px;">${name}</div>
        <div style="font-size:var(--font-size-xs);color:var(--text-muted);line-height:1.5;">${role}</div>
      </div>
    </div>
  `;
}
