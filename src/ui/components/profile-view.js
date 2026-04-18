import { DataStore } from '../../data/data-store.js';
import { getArtistMetadata } from '../../data/musicbrainz-api.js';
import { ProfilerAgent } from '../../agents/profiler-agent.js';
import { NarratorAgent } from '../../agents/narrator-agent.js';
import { mapToMacroGenres } from '../../data/genre-taxonomy.js';
import { getCurrentUser } from '../../data/spotify-api.js';

export class ProfileView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="glass-card" style="padding: var(--space-8); text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: var(--space-4); animation: pulse 1s infinite;">👤</div>
        <p style="color: var(--text-secondary);">Loading your Taste Identity (querying Agents...)</p>
      </div>
    `;

    const profiler = new ProfilerAgent();
    const tasteState = await profiler.buildTasteState();

    const eloRatings = DataStore.getEloRatings();
    const rankedArtists = Object.entries(eloRatings)
      .map(([id, data]) => ({ id, ...data }))
      .filter(a => a.name && a.name !== 'undefined' && a.id !== 'undefined')
      .sort((a, b) => b.rating - a.rating);

    if (rankedArtists.length === 0) {
      this.container.innerHTML = `
        <div class="glass-card" style="padding: var(--space-8); text-align: center;">
          <p style="color: var(--text-secondary);">Your taste profile will appear here after you play the Taste Game.</p>
          <button class="btn btn-primary btn-lg mt-4" onclick="location.hash='#/game'">Play Taste Game</button>
        </div>
      `;
      return;
    }

    // --- Compute all profile analytics from raw Elo data ---
    const stats = this._computeStats(rankedArtists, tasteState);

    // Agentic Insight Generation
    const narrator = new NarratorAgent();
    const agenticProfile = await narrator.generateAgenticProfile(tasteState);

    // Get explicit preferences for memory display
    const prefs = DataStore.getExplicitPreferences();

    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-6); animation: fadeInUp 400ms ease forwards;">

        <!-- Hero: Taste DNA + Top Artist -->
        <div style="display: grid; grid-template-columns: 1fr; gap: var(--space-4);">
          <!-- Taste DNA Hero Card -->
          <div style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(59, 130, 246, 0.08)); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: var(--radius-xl); padding: var(--space-6); position: relative; overflow: hidden; display: flex; align-items: center; gap: var(--space-6);">
            <div style="position: absolute; top: -20px; right: -20px; opacity: 0.04; transform: rotate(15deg); font-size: 150px;">🧬</div>
            
            <!-- Top Artist Avatar -->
            <div style="flex-shrink: 0; position: relative;">
              ${stats.topArtistImage 
                ? `<img src="${stats.topArtistImage}" style="width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 4px solid var(--accent-primary); box-shadow: 0 0 20px rgba(139, 92, 246, 0.4);">` 
                : `<div style="width: 120px; height: 120px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; border: 4px solid var(--accent-primary); color: var(--text-muted); font-size: 48px;">👤</div>`}
              <div style="position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%); background: var(--accent-primary); color: white; font-size: 10px; padding: 2px 8px; border-radius: 12px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 10px rgba(0,0,0,0.5);">#1 Artist</div>
            </div>

            <!-- Taste DNA Info -->
            <div style="flex: 1; z-index: 1;">
              <div style="font-size: 2rem; font-weight: var(--font-weight-bold); line-height: 1.2; margin-bottom: var(--space-3); background: var(--gradient-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${stats.tasteSignature}</div>
              <p style="font-size: 1.1rem; color: var(--text-primary); line-height: 1.5; margin-bottom: var(--space-2);">You're practically running the fan club for <strong>${stats.topArtistName}</strong>. Your vibe is a heavy dose of ${stats.topGenre}, but you're not afraid to mix it up with some ${stats.secondGenre} when the mood strikes.</p>
            </div>
          </div>
        </div>

        <!-- Row 2: Sonic Dossier -->
        <div style="background: rgba(139, 92, 246, 0.06); border: 1px solid rgba(139, 92, 246, 0.15); border-left: 4px solid var(--accent-primary); padding: var(--space-5); border-radius: var(--radius-lg); position: relative; overflow: hidden;">
          <div style="position: absolute; top: -10px; right: -10px; opacity: 0.03; transform: rotate(15deg); font-size: 80px;">🧠</div>
          <h2 style="font-size: var(--font-size-base); margin-bottom: var(--space-3); color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--accent-primary); display: flex; font-size: 18px;">✨</span> Your musical vibe
          </h2>
          <p style="font-size: 0.95rem; color: var(--text-secondary); line-height: 1.65; position: relative; z-index: 1;">
            ${agenticProfile}
          </p>
        </div>

        <!-- Row 3: Genre Radar + Taste Tiers -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4);">
          
          <!-- Genre Radar Chart (Canvas) -->
          <div class="glass-card" style="padding: var(--space-5);">
            <h3 style="font-size: var(--font-size-base); margin-bottom: var(--space-4); display: flex; align-items: center; gap: var(--space-2);">
              <span style="display: flex; color: var(--accent-primary); font-size: 20px;">🎸</span> Genre Radar
            </h3>
            <div style="display: flex; justify-content: center; align-items: center;">
              <canvas id="genre-radar-canvas" width="320" height="320" style="max-width: 100%;"></canvas>
            </div>
          </div>

          <!-- Dynamic Tier List -->
          <div class="glass-card" style="padding: var(--space-5); display: flex; flex-direction: column; gap: 4px; background: var(--bg-panel);">
            <h3 style="font-size: var(--font-size-base); margin-bottom: var(--space-3); display: flex; align-items: center; gap: var(--space-2);">
              <span style="display: flex; color: var(--accent-primary); font-size: 20px;">📊</span> The Tier List
            </h3>
            ${this._renderDynamicTierRow('S', stats.sTier, '#ff7f7f')}
            ${this._renderDynamicTierRow('A', stats.aTier, '#ffbf7f')}
            ${this._renderDynamicTierRow('B', stats.bTier, '#ffff7f')}
            ${this._renderDynamicTierRow('C', stats.cTier, '#7fff7f')}
            ${this._renderDynamicTierRow('F', stats.fTier, '#7fbfff')}
          </div>
        </div>

        <!-- Row 5: Leaderboard (Top 25, condensed) -->
        <div class="glass-card" style="padding: var(--space-5);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4);">
            <h2 style="font-size: var(--font-size-lg); display: flex; align-items: center; gap: var(--space-2);">
              <span style="display: flex; color: var(--accent-primary); font-size: 22px;">🏆</span> Leaderboard
            </h2>
            <span style="font-size: var(--font-size-xs); color: var(--text-muted);">${rankedArtists.length} rated artists</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-2); max-height: 500px; overflow-y: auto; padding-right: var(--space-2);">
            ${rankedArtists.slice(0, 30).map((a, i) => this._renderLeaderboardEntry(a, i, stats)).join('')}
          </div>
        </div>
      </div>
    `;

    // Draw canvas visualizations
    requestAnimationFrame(() => {
      this._drawRadarChart(stats.genreDistribution);
    });

    // Background task: Backfill missing genres via Last.fm for cached Elo ratings
    this._backfillMissingGenres(rankedArtists).catch(() => {});
  }

  // --- Compute all analytics from raw Elo data ---
  _computeStats(rankedArtists, tasteState) {
    const totalComparisons = rankedArtists.reduce((sum, a) => sum + (a.comparison_count || 0), 0);
    const gameDiscoveries = rankedArtists.filter(a => a.source === 'game' || a.source === 'search_inject');
    const maxElo = rankedArtists[0]?.rating || 1500;

    // Taste Tiers (Mapped to the 1-10 visual rating scale)
    const peakElo = Math.max(maxElo, 1550);
    const bottomElo = 1100;
    
    const getScore10 = (rating) => {
      let score10;
      if (rating >= 1500) {
        score10 = 7.5 + ((rating - 1500) / (peakElo - 1500)) * 2.5;
      } else {
        score10 = 1.0 + ((rating - bottomElo) / (1500 - bottomElo)) * 6.5;
      }
      return Math.max(1.0, Math.min(10.0, score10));
    };

    const sTier = rankedArtists.filter(a => getScore10(a.rating) >= 9.0);
    const aTier = rankedArtists.filter(a => { const s = getScore10(a.rating); return s >= 8.0 && s < 9.0; });
    const bTier = rankedArtists.filter(a => { const s = getScore10(a.rating); return s >= 6.0 && s < 8.0; });
    const cTier = rankedArtists.filter(a => { const s = getScore10(a.rating); return s >= 4.0 && s < 6.0; });
    const fTier = [...rankedArtists].reverse().filter(a => getScore10(a.rating) < 4.0);

    // Genre distribution from macro-genres
    const genreCounts = {};
    rankedArtists.forEach(a => {
      const genres = (a.macroGenres && a.macroGenres.length > 0) 
        ? a.macroGenres 
        : (a.genres && a.genres.length > 0 ? mapToMacroGenres(a.genres) : []);
      genres.forEach(g => {
        if (g === 'Unclassified' || g === 'Eclectic / Other') return;
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    });
    const genreColors = [
      'var(--accent-primary)', 'var(--accent-secondary)', 'var(--accent-amber)',
      'var(--accent-pink)', '#10b981', '#6366f1', '#ec4899', '#f59e0b', '#06b6d4', '#84cc16'
    ];
    const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
    const maxGenreCount = sortedGenres[0]?.[1] || 1;
    const genreDistribution = sortedGenres.slice(0, 8).map(([name, count], i) => ({
      name, count, pct: Math.round((count / maxGenreCount) * 100),
      color: genreColors[i % genreColors.length]
    }));

    // Taste Signature (computed tagline)
    const topGenre = sortedGenres[0]?.[0] || 'Eclectic';
    const secondGenre = sortedGenres[1]?.[0] || 'Alternative';
    const topArtistName = rankedArtists[0]?.name || 'Unknown';
    const topArtistImage = rankedArtists[0]?.imageUrl || null;
    const discoveryRatio = gameDiscoveries.length / Math.max(rankedArtists.length, 1);
    
    let archetypeLabel = '';
    if (discoveryRatio > 0.4) archetypeLabel = 'Explorer';
    else if (discoveryRatio > 0.2) archetypeLabel = 'Curator';
    else archetypeLabel = 'Devotee';

    const tasteSignature = secondGenre !== 'Alternative'
      ? `${topGenre} ${archetypeLabel} with a ${secondGenre} Edge`
      : `${topGenre} ${archetypeLabel}`;

    return {
      totalComparisons, 
      maxElo, 
      mean,
      stdDev,
      topArtistName,
      topArtistImage,
      topGenre,
      secondGenre,
      sTier, aTier, bTier, cTier, fTier,
      genreDistribution, tasteSignature
    };
  }

  _renderDynamicTierRow(tier, artists, color) {
    const avatars = artists.slice(0, 6).map(a => 
      a.imageUrl 
        ? `<img src="${a.imageUrl}" title="${a.name}" style="width: 44px; height: 44px; object-fit: cover; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">`
        : `<div title="${a.name}" style="width: 44px; height: 44px; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; color: var(--text-muted); flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.5); font-size: 20px;">🎵</div>`
    ).join('');
    
    return `
      <div style="display: flex; height: 48px; background: #1a1a1a; border: 1px solid #333; overflow: hidden; margin-bottom: 2px;">
        <!-- Grade Box -->
        <div style="width: 56px; background-color: ${color}; color: #111; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 1.8rem; border-right: 1px solid #333; flex-shrink: 0; font-family: 'Arial Black', Impact, sans-serif;">
          ${tier}
        </div>
        <!-- Images -->
        <div style="flex: 1; display: flex; align-items: center; gap: 4px; padding: 0 4px; overflow: hidden; background: #121212;">
          ${avatars}
        </div>
      </div>
    `;
  }

  _renderLeaderboardEntry(a, index, stats) {
    const displayGenres = (a.genres && a.genres.length > 0 && a.genres[0] !== 'Unclassified') 
      ? a.genres.slice(0,2).join(', ') 
      : '';
    const winRate = (a.comparison_count || 0) > 0 
      ? Math.round(((a.wins || 0) / a.comparison_count) * 100) 
      : null;
    const maxElo = Math.max(stats.maxElo, 1201);
    const eloBarWidth = Math.max(0, Math.min(100, Math.round(((a.rating - 1200) / (maxElo - 1200)) * 100)));
    
    // Piecewise scale: 1500 (average) is anchored to 7.5/10. Max is 10.0.
    const peakElo = Math.max(stats.maxElo, 1550);
    const bottomElo = 1100;
    
    let score10;
    if (a.rating >= 1500) {
      score10 = 7.5 + ((a.rating - 1500) / (peakElo - 1500)) * 2.5;
    } else {
      score10 = 1.0 + ((a.rating - bottomElo) / (1500 - bottomElo)) * 6.5;
    }
    
    score10 = Math.max(1.0, Math.min(10.0, score10));
    const displayScore = score10.toFixed(1);
    
    return `
      <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);background:var(--bg-card);border-radius:var(--radius-md);border:1px solid transparent;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--border-glass)'" onmouseout="this.style.borderColor='transparent'">
        <span style="font-weight:bold;color:var(--text-muted);width:24px;text-align:center;font-size:12px;flex-shrink:0;">${index === 0 ? '<span style="font-size: 14px; color: var(--accent-amber);">👑</span>' : `#${index+1}`}</span>
        ${a.imageUrl ? `<img src="${a.imageUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;color:var(--text-muted);flex-shrink:0;font-size: 16px;">🎵</div>`}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:var(--font-weight-medium);font-size:var(--font-size-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.name}</div>
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-top:2px;">
            ${displayGenres ? `<span style="font-size:10px;color:var(--text-muted);text-transform:capitalize;">${displayGenres}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;">
          <span style="font-size:12px;font-weight:var(--font-weight-semibold);color:var(--text-accent);font-variant-numeric:tabular-nums;">${displayScore} / 10</span>
          <div style="width:40px;height:3px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${eloBarWidth}%;background:var(--accent-primary);border-radius:2px;"></div>
          </div>
        </div>
      </div>
    `;
  }

  // --- Canvas: Genre Radar Chart ---
  _drawRadarChart(genreDistribution) {
    const canvas = document.getElementById('genre-radar-canvas');
    if (!canvas || genreDistribution.length === 0) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const maxR = Math.min(cx, cy) - 40;
    const n = Math.min(genreDistribution.length, 8);
    const data = genreDistribution.slice(0, n);
    const angleStep = (Math.PI * 2) / n;

    ctx.clearRect(0, 0, W, H);

    // Draw concentric rings
    for (let ring = 1; ring <= 4; ring++) {
      const r = (ring / 4) * maxR;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw axis lines and labels
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + i * angleStep;
      const x = cx + Math.cos(angle) * maxR;
      const y = cy + Math.sin(angle) * maxR;
      
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      const labelR = maxR + 20;
      const lx = cx + Math.cos(angle) * labelR;
      const ly = cy + Math.sin(angle) * labelR;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const name = data[i].name.length > 12 ? data[i].name.slice(0, 11) + '…' : data[i].name;
      ctx.fillText(name, lx, ly);
    }

    // Draw data polygon
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + i * angleStep;
      const value = data[i].pct / 100;
      const r = value * maxR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Fill with gradient
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    grad.addColorStop(0, 'rgba(139, 92, 246, 0.35)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.15)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw data points
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + i * angleStep;
      const value = data[i].pct / 100;
      const r = value * maxR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }



  async _backfillMissingGenres(rankedArtists) {
    let updated = false;
    const eloRatings = DataStore.getEloRatings();
    
    // Dynamic import to avoid heavy loads on init
    const { getArtistTags } = await import('../../data/lastfm-api.js');
    
    for (const a of rankedArtists) {
      let needsUpdate = false;
      
      // 1. Check if Last.fm tags are needed
      if (!a.genres || a.genres.length === 0 || a.genres[0] === 'Unclassified') {
        const tags = await getArtistTags(a.name);
        if (tags && tags.length > 0) {
          if (eloRatings[a.id]) {
            const validTags = tags.filter(t => !t.name.includes('seen live') && !t.name.includes('under 2000 listeners'));
            eloRatings[a.id].genres = validTags.slice(0, 3).map(t => t.name);
            a.genres = eloRatings[a.id].genres; // mutate local copy for next step
            needsUpdate = true;
          }
        }
      }

      // 2. Check if macroGenres are missing (for old artists before Taxonomy was introduced)
      if (eloRatings[a.id] && (!eloRatings[a.id].macroGenres || eloRatings[a.id].macroGenres.length === 0)) {
        eloRatings[a.id].macroGenres = mapToMacroGenres(a.genres || []);
        needsUpdate = true;
      }

      if (needsUpdate) updated = true;
    }
    
    if (updated) {
      DataStore.setEloRatings(eloRatings);
    }
  }
}

