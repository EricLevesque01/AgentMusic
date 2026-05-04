/**
 * TasteGraph — Chat Panel Component
 * Floating chat drawer powered by the Concierge Agent.
 * Available on all pages via a floating button.
 */
import { ConciergeAgent } from '../../agents/concierge-agent.js';

const SUGGESTIONS = [
  'What\'s my vibe?',
  'Make me a late night playlist',
  'Suggest artists like my favorites',
  'More underground tracks',
  'Who are my top artists?',
];

export class ChatPanel {
  constructor(orchestrator, getContext) {
    this.orchestrator = orchestrator;
    this.getContext   = getContext; // fn() → current PipelineContext
    this.concierge    = new ConciergeAgent();
    this.isOpen       = false;
    this.container    = null;
    this.panel        = null;
    this._openingShown = false; // Sprint 5.2: only fire proactive message once
  }

  mount(appEl) {
    // Create floating button
    this.fabBtn = document.createElement('button');
    this.fabBtn.id = 'chat-fab';
    this.fabBtn.setAttribute('aria-label', 'Open Agent Chat');
    this.fabBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `;
    this.fabBtn.style.cssText = `
      position: fixed;
      bottom: 88px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--gradient-primary);
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      z-index: var(--z-chat);
      box-shadow: var(--shadow-glow-strong);
      transition: transform var(--transition-spring);
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    this.fabBtn.addEventListener('click', () => this.toggle());
    this.fabBtn.addEventListener('mouseover', () => { this.fabBtn.style.transform = 'scale(1.1)'; });
    this.fabBtn.addEventListener('mouseout',  () => { this.fabBtn.style.transform = 'scale(1)'; });

    // Create panel
    this.panel = document.createElement('div');
    this.panel.id = 'chat-panel';
    this.panel.style.cssText = `
      position: fixed;
      bottom: 160px;
      right: 20px;
      width: 360px;
      max-width: calc(100vw - 40px);
      max-height: 520px;
      display: flex;
      flex-direction: column;
      background: rgba(17, 24, 39, 0.92);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg), var(--shadow-glow);
      z-index: var(--z-chat);
      transform: translateY(20px) scale(0.95);
      opacity: 0;
      pointer-events: none;
      transition: all 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
      overflow: hidden;
    `;
    this.panel.innerHTML = this._buildPanelHTML();

    appEl.appendChild(this.fabBtn);
    appEl.appendChild(this.panel);

    this._attachListeners();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.panel.style.opacity     = '1';
      this.panel.style.transform   = 'translateY(0) scale(1)';
      this.panel.style.pointerEvents = 'all';
      this.fabBtn.innerHTML = '✕';
      document.getElementById('chat-input')?.focus();

      // Sprint 5.2: Proactive opening message — fires once per session
      if (!this._openingShown) {
        this._openingShown = true;
        const context = this.getContext ? this.getContext() : null;
        try {
          const openingMsg = this.concierge.generateOpeningMessage(context);
          if (openingMsg) {
            const messagesEl = document.getElementById('chat-messages');
            if (messagesEl) {
              // Small delay so the panel animation completes first
              setTimeout(() => {
                messagesEl.insertAdjacentHTML('beforeend', this._botBubble(openingMsg));
                messagesEl.scrollTop = messagesEl.scrollHeight;
              }, 350);
            }
          }
        } catch (e) { /* Opening message is best-effort */ }
      }
    } else {
      this.panel.style.opacity     = '0';
      this.panel.style.transform   = 'translateY(20px) scale(0.95)';
      this.panel.style.pointerEvents = 'none';
      this.fabBtn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
    }
  }

  _buildPanelHTML() {
    return `
      <!-- Header -->
      <div style="padding: var(--space-4); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: var(--space-3);">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div>
            <div style="font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm);">Agent Music</div>
            <div style="font-size: 11px; color: var(--text-muted);">Powered by Gemini 2.0 Flash</div>
          </div>
        </div>
        <button id="chat-close-btn" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">✕</button>
      </div>

      <!-- Messages -->
      <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3);">
        ${this._botBubble("Hi! I'm Agent Music. Tell me how to tune your playlist — try <em>'more jazz'</em>, <em>'make it chill'</em>, or <em>'why this playlist?'</em>")}
        
        <!-- Suggestion chips -->
        <div id="suggestion-chips" style="display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-1);">
          ${SUGGESTIONS.map(s => `
            <button class="suggestion-chip" style="
              background: var(--bg-card); border: 1px solid var(--border-glass);
              border-radius: var(--radius-full); padding: 4px 10px;
              font-size: 11px; color: var(--text-secondary); cursor: pointer;
              font-family: var(--font-family); transition: all var(--transition-fast);
            " onmouseover="this.style.borderColor='var(--accent-primary)';this.style.color='var(--text-primary)'"
               onmouseout="this.style.borderColor='var(--border-glass)';this.style.color='var(--text-secondary)'"
            >${s}</button>
          `).join('')}
        </div>
      </div>

      <!-- Input -->
      <div style="padding: var(--space-3); border-top: 1px solid var(--border-subtle); display: flex; gap: var(--space-2);">
        <input id="chat-input" type="text" placeholder="Ask about your playlist..."
          style="flex: 1; background: var(--bg-card); border: 1px solid var(--border-glass);
                 border-radius: var(--radius-full); padding: var(--space-2) var(--space-4);
                 color: var(--text-primary); font-family: var(--font-family); font-size: var(--font-size-sm);
                 outline: none; transition: border-color var(--transition-fast);"
          onfocus="this.style.borderColor='var(--accent-primary)'"
          onblur="this.style.borderColor='var(--border-glass)'"
        />
        <button id="chat-send" style="
          width: 36px; height: 36px; border-radius: 50%; background: var(--gradient-primary);
          border: none; cursor: pointer; font-size: 1rem; display: flex; align-items: center;
          justify-content: center; flex-shrink: 0; transition: transform var(--transition-fast);
        " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">➤</button>
      </div>
    `;
  }

  _attachListeners() {
    // Send on button click
    this.panel.addEventListener('click', async (e) => {
      if (e.target.closest('#chat-close-btn')) {
        this.toggle();
        return;
      }
      
      if (e.target.closest('#chat-send')) {
        await this._sendMessage();
      }

      // Suggestion chip click
      if (e.target.classList.contains('suggestion-chip')) {
        const chips = document.getElementById('suggestion-chips');
        if (chips) chips.remove();
        await this._sendMessage(e.target.textContent);
      }
    });

    // Send on Enter
    this.panel.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && e.target.id === 'chat-input') {
        await this._sendMessage();
      }
    });
  }

  async _sendMessage(textOverride = null) {
    const input = document.getElementById('chat-input');
    const text  = textOverride || input?.value?.trim();
    if (!text) return;

    if (input) input.value = '';

    const messagesEl = document.getElementById('chat-messages');
    if (!messagesEl) return;

    // Show user bubble
    messagesEl.insertAdjacentHTML('beforeend', this._userBubble(text));

    // Show typing indicator
    const typingId = 'typing-' + Date.now();
    messagesEl.insertAdjacentHTML('beforeend', `
      <div id="${typingId}" style="display:flex;gap:6px;align-items:center;padding:8px 12px;background:var(--bg-card);border-radius:12px;width:fit-content;">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);animation:pulse 1s infinite;"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);animation:pulse 1s infinite 0.2s;"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);animation:pulse 1s infinite 0.4s;"></div>
      </div>
    `);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      let context = this.getContext ? this.getContext() : null;
      if (!context || !context.tasteState) {
        if (!this.profiler) {
          const { ProfilerAgent } = await import('../../agents/profiler-agent.js');
          this.profiler = new ProfilerAgent();
        }
        const tasteState = await this.profiler.buildTasteState();
        context = { tasteState };
      }

      // Enrich context with live Elo leaderboard for taste-aware responses
      const { DataStore } = await import('../../data/data-store.js');
      const eloRatings = DataStore.getEloRatings();
      const ranked = Object.entries(eloRatings)
        .filter(([, d]) => d.name && d.name !== 'undefined' && (d.comparison_count || 0) > 0)
        .sort((a, b) => b[1].rating - a[1].rating);
      
      if (!context.tasteState) context.tasteState = {};
      context.tasteState.topRankedArtists = ranked.slice(0, 10).map(([id, d]) => ({ id, name: d.name, rating: d.rating, genres: d.genres || [] }));
      context.tasteState.totalRatedArtists = ranked.length;

      const { reply, actions } = await this.concierge.chat(text, context);

      // Remove typing indicator
      document.getElementById(typingId)?.remove();

      // Handle explain_track specially
      const explainTrack = actions.find(a => a.type === 'explain_track');
      let displayReply = reply;
      if (explainTrack && context) {
        displayReply = this.concierge.explainTrack(explainTrack.trackName, context);
      }

      // Show explain_playlist
      if (actions.find(a => a.type === 'explain_playlist') && context?.explanations) {
        displayReply = context.explanations.playlistSummary || reply;
      }

      messagesEl.insertAdjacentHTML('beforeend', this._botBubble(displayReply));

      // Dispatch actionable events
      const actionableTypes = ['boost_genre', 'penalize_genre', 'regenerate', 'create_playlist', 'adjust_preference'];
      for (const action of actions) {
        if (action.type === 'remember_fact') {
          window.dispatchEvent(new CustomEvent('tastegraph:remember-fact', { detail: action.fact }));
          messagesEl.insertAdjacentHTML('beforeend', this._botBubble(`🧠 Saved to your permanent Profile Preferences.`, true));
        } else if (action.type === 'suggest_artists') {
          window.dispatchEvent(new CustomEvent('tastegraph:inject-artists', { detail: action.artists }));
          messagesEl.insertAdjacentHTML('beforeend', this._botBubble(`🎸 I've injected **${action.artists.join(', ')}** into your comparison queue! Play the next round to evaluate my picks.`, true));
        } else if (action.type === 'summarize_taste') {
          messagesEl.insertAdjacentHTML('beforeend', this._botBubble(`*Generating Sonic Dossier...*`, true));
          const { NarratorAgent } = await import('../../agents/narrator-agent.js');
          const narrator = new NarratorAgent();
          const profile = await narrator.generateAgenticProfile(context.tasteState);
          messagesEl.insertAdjacentHTML('beforeend', this._botBubble(`**Your Musical Vibe:**<br><br>${profile}`));
        } else if (actionableTypes.includes(action.type) && this.orchestrator) {
          try {
            const newContext = await this.orchestrator.handleConciergeAction(action);
            
            if (action.type === 'create_playlist' && newContext) {
              window.TG.lastContext = newContext;
              const { DataStore } = await import('../../data/data-store.js');
              DataStore.saveToLibrary(newContext, action.theme || 'Concierge Curated Mix', 'concierge');
            }
            
            window.dispatchEvent(new CustomEvent('tastegraph:playlist-updated'));
            messagesEl.insertAdjacentHTML('beforeend', this._botBubble('✅ Action completed!', true));
          } catch (e) {
            messagesEl.insertAdjacentHTML('beforeend', this._botBubble('⚠️ Couldn\'t update — try generating a playlist first.', true));
          }
        }
      }
    } catch (err) {
      document.getElementById(typingId)?.remove();
      messagesEl.insertAdjacentHTML('beforeend', this._botBubble('Sorry, something went wrong. Please try again.'));
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  _userBubble(text) {
    return `
      <div style="display:flex;justify-content:flex-end;">
        <div style="background:var(--gradient-primary);color:white;padding:8px 14px;border-radius:16px 16px 4px 16px;max-width:80%;font-size:var(--font-size-sm);line-height:1.5;">${this._escapeHtml(text)}</div>
      </div>
    `;
  }

  _botBubble(text, small = false) {
    return `
      <div style="display:flex;gap:var(--space-2);align-items:flex-start;">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:0.8rem;flex-shrink:0;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);padding:8px 14px;border-radius:4px 16px 16px 16px;max-width:82%;font-size:${small ? '12px' : 'var(--font-size-sm)'};color:var(--text-${small ? 'muted' : 'primary'});line-height:1.5;">${text}</div>
      </div>
    `;
  }

  _escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
