const UI = (() => {

  let monsterRows = [], pcRows = [], mIdCtr = 0, pcIdCtr = 0;
  let watchEvents = [], watchIdx = 0, watchTimer = null, watchSpeed = 500;

  function eventToText(ev) {
    const em = (name) => {
      const m = ev.state.monsters.find(x => x.name === name); if (m) return m.em;
      const p = ev.state.party.find(x => x.name === name); return p ? p.em : '';
    };
    switch (ev.type) {
      case 'round_start':   return `=== Round ${ev.round} ===`;
      case 'round_end':     return '';
      case 'combat_end':    return `--- ${ev.monstersWon ? 'Monsters win' : 'Party wins'} after ${ev.rounds} rounds. Deaths: ${ev.deaths} ---`;
      case 'attack':        return ev.hit
        ? `  ${em(ev.attacker)} ${ev.attacker} attacks ${em(ev.target)} ${ev.target}: ${ev.dmg}dmg${ev.crit ? ' CRIT' : ''} (${ev.roll})`
        : `  ${em(ev.attacker)} ${ev.attacker} attacks ${em(ev.target)} ${ev.target}: MISS (${ev.roll})`;
      case 'spell':         return `  ${em(ev.caster)} ${ev.caster} casts ${ev.spell} at ${em(ev.target)} ${ev.target}: ${ev.dmg}dmg${ev.saved ? ' (saved)' : ''}`;
      case 'cantrip':       return ev.hit
        ? `  ${em(ev.caster)} ${ev.caster} casts ${ev.spell} at ${em(ev.target)} ${ev.target}: ${ev.dmg}dmg${ev.crit ? ' CRIT' : ''}`
        : `  ${em(ev.caster)} ${ev.caster} casts ${ev.spell} at ${em(ev.target)} ${ev.target}: MISS`;
      case 'heal':          return `  ${em(ev.healer)} ${ev.healer} heals ${em(ev.target)} ${ev.target} for ${ev.amt}`;
      case 'special':       return `  ${em(ev.attacker)} ${ev.attacker} uses ${ev.ability}! \u2192 ${ev.targets.map((t, i) => `${em(t)}${t}:${ev.dmg[i]}dmg`).join(', ')}`;
      case 'friendly_fire': return `    Friendly fire ${em(ev.target)} ${ev.target}: ${ev.dmg}dmg`;
      case 'surge':         return `  \u26a1 ${ev.caster}: ACTION SURGE`;
      case 'sneak':         return `  \uD83D\uDDE1\uFE0F Rogue: SNEAK ATTACK +${ev.bonus}`;
      case 'down':          return `  ${em(ev.name)} ${ev.name}: DOWN`;
      case 'death':         return `  ${em(ev.name)} ${ev.name}: DEAD`;
      case 'recovery':      return `  ${em(ev.name)} ${ev.name}: miraculous recovery`;
      case 'stabilized':    return `  ${em(ev.name)} ${ev.name}: stabilized`;
      default:              return '';
    }
  }

  function hpColor(pct) {
    return pct > 0.5 ? '#639922' : pct > 0.25 ? '#BA7517' : '#A32D2D';
  }

  function makeCombatant(em, chp, maxHp, dead, down, isDeathFlash, isHit, isCrit, actionEm) {
    if (dead && !isDeathFlash) return null;
    const wrap = document.createElement('div'); wrap.className = 'combatant';
    const emEl = document.createElement('div'); emEl.className = 'combatant-em';
    if (isDeathFlash) {
      emEl.textContent = em + '\uD83D\uDC80';
    } else {
      let label = em;
      if (isHit)    label += isCrit ? '\uD83D\uDCA5\uD83D\uDCA5' : '\uD83D\uDCA5';
      if (actionEm) label += actionEm;
      emEl.textContent = label;
      emEl.style.opacity = down ? '0.5' : '1';
    }
    wrap.appendChild(emEl);
    if (!dead && !down && !isDeathFlash && maxHp > 0) {
      const pct = Math.max(0, Math.min(1, chp / maxHp));
      const bw = document.createElement('div'); bw.className = 'hp-bar-wrap';
      const b  = document.createElement('div'); b.className  = 'hp-bar';
      b.style.width      = Math.round(pct * 100) + '%';
      b.style.background = hpColor(pct);
      bw.appendChild(b); wrap.appendChild(bw);
    }
    return wrap;
  }

  function buildClusters(state) {
    const { monsters, party } = state;
    const livingM = monsters.filter(m => !m.dead);
    const clusters = []; const assigned = new Set();
    for (const m of livingM) {
      if (assigned.has(m.name)) continue;
      const myKey = m.meleePCs.slice().sort().join('|');
      const cms = [m]; assigned.add(m.name);
      for (const m2 of livingM) {
        if (assigned.has(m2.name)) continue;
        if (m2.meleePCs.slice().sort().join('|') === myKey) { cms.push(m2); assigned.add(m2.name); }
      }
      const pcMap = new Map();
      for (const mc of cms) {
        for (const pn of mc.meleePCs) {
          const p = party.find(x => x.name === pn); if (p) pcMap.set(p.name, p);
        }
        if (mc.targetName && mc.targetZone === 'back') {
          const p = party.find(x => x.name === mc.targetName);
          if (p && !p.dead) pcMap.set(p.name, p);
        }
      }
      clusters.push({ monsters: cms, pcs: [...pcMap.values()] });
    }
    const engagedNames = new Set(clusters.flatMap(c => c.pcs.map(p => p.name)));
    const backPCs = party.filter(p => p.zone === 'back' && !engagedNames.has(p.name));
    return { clusters, backPCs };
  }

  function getActionEmoji(ev) {
    if (!ev) return null;
    if (ev.type === 'attack')                         return '\u2694\uFE0F';
    if (ev.type === 'spell' || ev.type === 'cantrip') return '\u2728';
    if (ev.type === 'heal')                           return '\uD83D\uDC9A';
    if (ev.type === 'special')                        return '\uD83D\uDD25';
    return null;
  }

  function renderBattlefield(el, ev) {
    if (!el) return;
    el.innerHTML = '';
    const state = ev.state;
    const rl = document.createElement('div'); rl.className = 'round-label';
    rl.textContent = ev.round ? `Round ${ev.round}` : '';
    el.appendChild(rl);
    const { clusters, backPCs } = buildClusters(state);
    const inner = document.createElement('div'); inner.className = 'bf-inner';
    const hitTarget   = (ev.type === 'attack' || ev.type === 'spell' || ev.type === 'cantrip') && ev.hit ? ev.target : null;
    const critTarget  = hitTarget && ev.crit ? ev.target : null;
    const deathTarget = ev.type === 'death' ? ev.name : null;
    const attacker    = ev.attacker || ev.caster || ev.healer || null;
    const actionEm    = getActionEmoji(ev);
    let attackerClusterIdx = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].monsters.find(m => m.name === attacker) ||
          clusters[i].pcs.find(p => p.name === attacker)) { attackerClusterIdx = i; break; }
    }
    const attackerInBack = attacker && backPCs.find(p => p.name === attacker);
    const meleeSection = document.createElement('div'); meleeSection.className = 'bf-section';
    const ml = document.createElement('div'); ml.className = 'bf-label'; ml.textContent = 'Melee';
    meleeSection.appendChild(ml);
    const clustersDiv = document.createElement('div'); clustersDiv.className = 'bf-clusters';
    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      const cd = document.createElement('div'); cd.className = 'bf-cluster';
      const mrow = document.createElement('div'); mrow.className = 'bf-row';
      for (const m of cluster.monsters) {
        const isDeath = deathTarget === m.name;
        const isAttkr = attacker === m.name && ci === attackerClusterIdx;
        const cw = makeCombatant(m.em, m.chp, m.hp, m.dead, false, isDeath, hitTarget === m.name && !isDeath, critTarget === m.name, isAttkr ? actionEm : null);
        if (cw) mrow.appendChild(cw);
      }
      cd.appendChild(mrow);
      const ar = document.createElement('div'); ar.className = 'bf-action-row';
      if (ci === attackerClusterIdx && actionEm) ar.textContent = actionEm;
      cd.appendChild(ar);
      if (cluster.pcs.length) {
        const prow = document.createElement('div'); prow.className = 'bf-row';
        for (const p of cluster.pcs) {
          const isDeath = deathTarget === p.name;
          const isAttkr = attacker === p.name && ci === attackerClusterIdx;
          const cw = makeCombatant(p.em, p.chp, p.maxHp, p.dead, p.down, isDeath, hitTarget === p.name && !isDeath, critTarget === p.name, isAttkr ? actionEm : null);
          if (cw) prow.appendChild(cw);
        }
        cd.appendChild(prow);
      }
      clustersDiv.appendChild(cd);
    }
    meleeSection.appendChild(clustersDiv);
    inner.appendChild(meleeSection);
    const dv = document.createElement('div'); dv.className = 'bf-divider';
    inner.appendChild(dv);
    const backSection = document.createElement('div'); backSection.className = 'bf-section';
    const bl = document.createElement('div'); bl.className = 'bf-label'; bl.textContent = 'Back';
    backSection.appendChild(bl);
    const brow = document.createElement('div'); brow.className = 'bf-row';
    for (const p of backPCs) {
      const isDeath = deathTarget === p.name;
      const isAttkr = attacker === p.name && !!attackerInBack;
      const cw = makeCombatant(p.em, p.chp, p.maxHp, p.dead, p.down, isDeath, hitTarget === p.name && !isDeath, critTarget === p.name, isAttkr ? actionEm : null);
      if (cw) brow.appendChild(cw);
    }
    backSection.appendChild(brow);
    inner.appendChild(backSection);
    el.appendChild(inner);
  }

  function addMonster(isBoss = false, data = {}) {
    const id = mIdCtr++;
    monsterRows.push({ id, boss: isBoss || monsterRows.length === 0, ...data });
    renderMonsterBuilder();
  }

  function removeMonster(id) {
    if (monsterRows.find(m => m.id === id)?.boss) { alert('Cannot remove boss.'); return; }
    monsterRows = monsterRows.filter(m => m.id !== id);
    renderMonsterBuilder();
  }

  function renderMonsterBuilder() {
    const el = document.getElementById('monster-builder');
    el.innerHTML = monsterRows.map(m => {
      const em = m.boss ? DATA.MONSTER_EMOJI.boss : DATA.MONSTER_EMOJI.minion;
      return `<div class="monster-card">
        <div class="card-header">
          <span>${em} ${m.boss ? 'Boss' : 'Minion'}<span class="boss-label">${m.boss ? 'boss' : 'minion'}</span></span>
          ${!m.boss ? `<button onclick="UI.removeMonster(${m.id})" style="padding:3px 8px;font-size:11px;margin:0;">Remove</button>` : ''}
        </div>
        <div class="row">
          <div class="field"><label>Name</label><input id="mn-${m.id}" value="${m.name || (m.boss ? 'Boss' : 'Minion')}"/></div>
          <div class="field"><label>AC</label><input id="mac-${m.id}" type="number" value="${m.ac || 13}"/></div>
          <div class="field"><label>HP</label><input id="mhp-${m.id}" type="number" value="${m.hp || (m.boss ? 50 : 10)}"/></div>
          <div class="field"><label>Atk bonus</label><input id="matk-${m.id}" type="number" value="${m.atk || 4}"/></div>
          <div class="field"><label>Damage</label><input id="mdmg-${m.id}" value="${m.dmg || (m.boss ? '1d8+2' : '1d6+2')}"/></div>
          <div class="field"><label>Attacks</label><input id="matts-${m.id}" type="number" value="${m.atts || 1}"/></div>
          <div class="field"><label>Type</label><select id="mtype-${m.id}">
            <option value="melee"${(m.type || 'melee') === 'melee' ? ' selected' : ''}>Melee</option>
            <option value="ranged"${m.type === 'ranged' ? ' selected' : ''}>Ranged</option>
          </select></div>
        </div>
        ${m.boss ? `<div style="margin-top:6px;font-size:10px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Special ability - optional</div>
        <div class="row3">
          <div class="field"><label>Name (blank = none)</label><input id="saname-${m.id}" value="${m.saname || ''}"/></div>
          <div class="field"><label>Damage</label><input id="sadmg-${m.id}" value="${m.sadmg || '2d6+2'}"/></div>
          <div class="field"><label>Save DC (0=auto)</label><input id="sadc-${m.id}" type="number" value="${m.sadc || 0}"/></div>
          <div class="field"><label>Targets</label><select id="sazone-${m.id}">
            <option value="melee"${m.sazone === 'melee' ? ' selected' : ''}>Melee zone</option>
            <option value="back"${(!m.sazone || m.sazone === 'back') ? ' selected' : ''}>Back zone</option>
            <option value="all"${m.sazone === 'all' ? ' selected' : ''}>All</option>
          </select></div>
          <div class="field"><label>Every N rounds</label><input id="saevery-${m.id}" type="number" value="${m.saevery || 3}"/></div>
        </div>` : ''}
      </div>`;
    }).join('');
  }

  function addPC(cls = 'Fighter') {
    const id = pcIdCtr++;
    const def = DATA.CLASSES.find(c => c.name === cls) || DATA.CLASSES[0];
    pcRows.push({ id, cls: def.cls, zone: def.zone });
    renderPartyBuilder();
  }

  function removePC(id) { pcRows = pcRows.filter(p => p.id !== id); renderPartyBuilder(); }

  function updatePC(id, key, val) {
    const p = pcRows.find(p => p.id === id);
    if (p) {
      p[key] = val;
      if (key === 'cls') { const def = DATA.CLASSES.find(c => c.cls === val); if (def) p.zone = def.zone; renderPartyBuilder(); }
    }
  }

  function renderPartyBuilder() {
    const el = document.getElementById('party-builder');
    if (!pcRows.length) { el.innerHTML = '<div style="color:var(--color-text-secondary);font-size:12px;margin-bottom:8px;">No PCs.</div>'; return; }
    el.innerHTML = pcRows.map(p => `
      <div class="pc-row">
        <div class="field"><label>Class</label>
          <select onchange="UI.updatePC(${p.id},'cls',this.value)">
            ${DATA.CLASSES.map(c => `<option value="${c.cls}"${c.cls === p.cls ? ' selected' : ''}>${DATA.CLASS_EMOJI[c.cls]} ${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Zone</label>
          <select onchange="UI.updatePC(${p.id},'zone',this.value)">
            <option value="melee"${p.zone === 'melee' ? ' selected' : ''}>Melee</option>
            <option value="back"${p.zone === 'back' ? ' selected' : ''}>Back</option>
          </select>
        </div>
        <div class="field"><label>Override AC</label><input type="number" placeholder="auto" onchange="UI.updatePC(${p.id},'acOverride',this.value?+this.value:null)"/></div>
        <div class="field"><label>Override HP</label><input type="number" placeholder="auto" onchange="UI.updatePC(${p.id},'hpOverride',this.value?+this.value:null)"/></div>
        <button class="remove-btn" onclick="UI.removePC(${p.id})">\u00d7</button>
      </div>`).join('');
  }

  function readMonsters() {
    return monsterRows.map(m => ({
      id: m.id, boss: m.boss,
      name:    document.getElementById(`mn-${m.id}`)?.value     || 'Monster',
      ac:     +document.getElementById(`mac-${m.id}`)?.value    || 13,
      hp:     +document.getElementById(`mhp-${m.id}`)?.value    || 20,
      atk:    +document.getElementById(`matk-${m.id}`)?.value   || 4,
      dmgStr:  document.getElementById(`mdmg-${m.id}`)?.value   || '1d6',
      atts:   +document.getElementById(`matts-${m.id}`)?.value  || 1,
      type:    document.getElementById(`mtype-${m.id}`)?.value  || 'melee',
      saName:  m.boss ? (document.getElementById(`saname-${m.id}`)?.value || '') : '',
      saDmg:   m.boss ? (document.getElementById(`sadmg-${m.id}`)?.value  || '2d6') : '',
      saDC:    m.boss ? (+document.getElementById(`sadc-${m.id}`)?.value  || 0) : 0,
      saZone:  m.boss ? (document.getElementById(`sazone-${m.id}`)?.value || 'back') : '',
      saEvery: m.boss ? (+document.getElementById(`saevery-${m.id}`)?.value || 3) : 3,
    }));
  }

  function buildParty(lvl) { return pcRows.map(p => ENGINE.buildPC(p, lvl)); }

  function runSims() {
    const mCfgs = readMonsters();
    const lvl = +document.getElementById('plevel').value;
    const N   = +document.getElementById('nsims').value || 100;
    if (!pcRows.length) { document.getElementById('output').innerHTML = '<div style="color:var(--color-text-secondary);">Add at least one PC.</div>'; return; }
    let wins = 0, totalRounds = 0, totalDeaths = 0;
    for (let i = 0; i < N; i++) {
      const party = buildParty(lvl);
      const r = ENGINE.simulate(mCfgs, party);
      if (!r.monstersWon) wins++;
      totalRounds += r.rounds; totalDeaths += r.deaths;
    }
    const pwPct = ((wins / N) * 100).toFixed(1);
    const ar    = (totalRounds / N).toFixed(1);
    const ad    = (totalDeaths / N).toFixed(1);
    const partyDesc     = pcRows.map(p => { const def = DATA.CLASSES.find(c => c.cls === p.cls); return `${DATA.CLASS_EMOJI[p.cls] || ''} ${def.name}<span class="zone-tag">${p.zone}</span>`; }).join(' ');
    const encounterDesc = readMonsters().map(m => `${m.boss ? DATA.MONSTER_EMOJI.boss : DATA.MONSTER_EMOJI.minion} ${m.name}`).join(' + ');
    document.getElementById('output').innerHTML = `
      <div class="result-card">
        <div class="header-meta">${encounterDesc} vs level ${lvl} party \u2014 ${N} simulations</div>
        <div class="party-tags">${partyDesc}</div>
        <div class="stat-row">
          <div class="stat"><span class="stat-val ${wins / N >= 0.5 ? 'win' : 'lose'}">${pwPct}%</span><span class="stat-lbl">Party win rate</span></div>
          <div class="stat"><span class="stat-val">${wins}W / ${N - wins}L</span><span class="stat-lbl">Record</span></div>
          <div class="stat"><span class="stat-val">${ar}</span><span class="stat-lbl">Avg rounds</span></div>
          <div class="stat"><span class="stat-val">${ad}</span><span class="stat-lbl">Avg deaths</span></div>
        </div>
      </div>`;
  }

  function watchFight() {
    const mCfgs = readMonsters();
    const lvl   = +document.getElementById('plevel').value;
    if (!pcRows.length) { alert('Add at least one PC.'); return; }
    const party  = buildParty(lvl);
    const result = ENGINE.simulate(mCfgs, party);
    watchEvents  = result.events.filter(ev => ev.type !== 'round_end' && eventToText(ev) !== '');
    watchIdx     = 0;
    const transcript = result.events.map(ev => eventToText(ev)).filter(t => t !== '').join('\n');
    const out = document.getElementById('output');
    out.innerHTML = `
      <div id="battlefield" class="battlefield"></div>
      <div class="ticker-box"><div class="ticker-line" id="ticker-text">...</div></div>
      <div class="ticker-controls">
        <button onclick="UI.toggleWatch()" id="btn-play">Pause</button>
        <button onclick="UI.stepWatch(-1)">\u2190 Step</button>
        <button onclick="UI.stepWatch(1)">Step \u2192</button>
        <div class="speed-row"><span>Speed:</span>
          <select onchange="UI.setSpeed(this.value)" style="width:auto;padding:3px 6px;">
            <option value="900">Slow</option>
            <option value="500" selected>Normal</option>
            <option value="250">Fast</option>
            <option value="80">Very fast</option>
          </select>
        </div>
        <span class="progress" id="watch-progress">1 / ${watchEvents.length}</span>
      </div>
      <details style="margin-top:4px;">
        <summary style="cursor:pointer;font-size:11px;color:var(--color-text-secondary);padding:4px 0;">Show full transcript</summary>
        <div class="transcript-box"><pre>${transcript}</pre></div>
      </details>`;
    if (watchEvents.length) renderBattlefield(document.getElementById('battlefield'), watchEvents[0]);
    watchTimer = setInterval(() => {
      showWatchStep();
      if (watchIdx >= watchEvents.length) { clearInterval(watchTimer); watchTimer = null; const b = document.getElementById('btn-play'); if (b) b.textContent = 'Play'; }
    }, watchSpeed);
  }

  function showWatchStep() {
    const el   = document.getElementById('ticker-text');
    const prog = document.getElementById('watch-progress');
    if (!el || watchIdx >= watchEvents.length) return;
    const ev   = watchEvents[watchIdx];
    const bf   = document.getElementById('battlefield');
    if (bf) renderBattlefield(bf, ev);
    const line = eventToText(ev);
    el.classList.add('fade');
    setTimeout(() => {
      if (document.getElementById('ticker-text') === el) {
        el.textContent = line || '\u00b7'; el.classList.remove('fade');
        if (prog) prog.textContent = `${watchIdx + 1} / ${watchEvents.length}`;
      }
    }, 150);
    watchIdx++;
  }

  function toggleWatch() {
    const btn = document.getElementById('btn-play');
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; if (btn) btn.textContent = 'Play'; }
    else {
      if (watchIdx >= watchEvents.length) watchIdx = 0;
      if (btn) btn.textContent = 'Pause';
      watchTimer = setInterval(() => {
        showWatchStep();
        if (watchIdx >= watchEvents.length) { clearInterval(watchTimer); watchTimer = null; const b = document.getElementById('btn-play'); if (b) b.textContent = 'Play'; }
      }, watchSpeed);
    }
  }

  function stepWatch(dir) {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; const b = document.getElementById('btn-play'); if (b) b.textContent = 'Play'; }
    if (dir < 0) watchIdx = Math.max(0, watchIdx - 2);
    showWatchStep();
  }

  function setSpeed(v) {
    watchSpeed = +v;
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = setInterval(() => {
        showWatchStep();
        if (watchIdx >= watchEvents.length) { clearInterval(watchTimer); watchTimer = null; const b = document.getElementById('btn-play'); if (b) b.textContent = 'Play'; }
      }, watchSpeed);
    }
  }

  function saveEncounter() {
    const mCfgs = readMonsters();
    try { localStorage.setItem('playtester_encounter', JSON.stringify({ monsters: mCfgs })); alert('Saved.'); }
    catch (e) { alert('Storage unavailable.'); }
  }

  function loadEncounter() {
    try {
      const raw = localStorage.getItem('playtester_encounter');
      if (!raw) { alert('No saved encounter.'); return; }
      const data = JSON.parse(raw);
      monsterRows = []; mIdCtr = 0;
      data.monsters.forEach(m => addMonster(m.boss, { name:m.name, ac:m.ac, hp:m.hp, atk:m.atk, dmg:m.dmgStr, atts:m.atts, type:m.type, saname:m.saName, sadmg:m.saDmg, sadc:m.saDC, sazone:m.saZone, saevery:m.saEvery }));
      alert('Loaded.');
    } catch (e) { alert('Failed to load.'); }
  }

  return {
    addMonster, removeMonster,
    addPC, removePC, updatePC,
    runSims, watchFight,
    toggleWatch, stepWatch, setSpeed,
    saveEncounter, loadEncounter,
  };

})();
