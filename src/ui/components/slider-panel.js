/**
 * TasteGraph — Slider Panel Component
 * Manages the 5 session intent sliders (ephemeral).
 */
import { PipelineContext } from '../../agents/pipeline-context.js';
import { DataStore } from '../../data/data-store.js';

export class SliderPanel {
  constructor(container, onChangeCallback = null) {
    this.container = container;
    this.onChangeCallback = onChangeCallback;
    this.values = this.loadValues();
  }

  loadValues() {
    try {
      const stored = sessionStorage.getItem('tg_sliders');
      if (stored) return JSON.parse(stored);
    } catch {
      // Ignore
    }
    const defaults = DataStore.getSessionDefaults();
    return {
      discovery: defaults.adventurousness ?? 0.5,
      popularity: defaults.popularity ?? 0.5,
      focus: defaults.cohesion ?? 0.5,
      energy: defaults.energy ?? 0.5,
      novelty: defaults.novelty ?? 0.5,
    };
  }

  saveValues() {
    sessionStorage.setItem('tg_sliders', JSON.stringify(this.values));
    if (this.onChangeCallback) {
      this.onChangeCallback(this.values);
    }
  }

  getValues() {
    return this.values;
  }

  render() {
    this.container.innerHTML = `
      <div class="glass-card" style="padding: var(--space-6); margin-bottom: var(--space-6);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4);">
          <h3 style="font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold);">Session Intent</h3>
          <button class="btn btn-ghost btn-sm" id="reset-sliders-btn" style="padding: var(--space-1) var(--space-2); font-size: var(--font-size-xs);">Reset</button>
        </div>
        
        <div class="slider-container" style="gap: var(--space-5);">
          ${this._renderSlider('discovery', 'Discovery', '🏠 Familiar', '🧭 Adventurous')}
          ${this._renderSlider('popularity', 'Popularity', '🌟 Mainstream', '🕳️ Underground')}
          ${this._renderSlider('focus', 'Focus', '🎯 Cohesive', '🎲 Varied')}
          ${this._renderSlider('energy', 'Energy', '😴 Low', '⚡ High')}
          ${this._renderSlider('novelty', 'Novelty', '🔁 Known', '❓ Unknown')}
        </div>
      </div>
    `;

    // Attach listeners
    ['discovery', 'popularity', 'focus', 'energy', 'novelty'].forEach(key => {
      const input = document.getElementById(`slider-${key}`);
      const valDisplay = document.getElementById(`val-${key}`);
      
      input.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.values[key] = val;
        valDisplay.textContent = val.toFixed(2);
      });

      input.addEventListener('change', () => {
        this.saveValues();
      });
    });

    document.getElementById('reset-sliders-btn').addEventListener('click', () => {
      const defaults = DataStore.getSessionDefaults();
      this.values = { 
        discovery: defaults.adventurousness ?? 0.5, 
        popularity: defaults.popularity ?? 0.5, 
        focus: defaults.cohesion ?? 0.5, 
        energy: defaults.energy ?? 0.5, 
        novelty: defaults.novelty ?? 0.5 
      };
      this.saveValues();
      this.render(); // Re-render to update inputs
    });
  }

  _renderSlider(key, label, minLabel, maxLabel) {
    const val = this.values[key];
    return `
      <div style="display: flex; flex-direction: column; gap: var(--space-1);">
        <div class="slider-label">
          <span style="font-weight: var(--font-weight-medium); color: var(--text-primary);">${label}</span>
          <span id="val-${key}" style="color: var(--text-accent); font-variant-numeric: tabular-nums;">${val.toFixed(2)}</span>
        </div>
        <input type="range" id="slider-${key}" min="0" max="1" step="0.05" value="${val}">
        <div class="slider-label" style="font-size: 11px; margin-top: 2px;">
          <span>${minLabel}</span>
          <span>${maxLabel}</span>
        </div>
      </div>
    `;
  }
}
