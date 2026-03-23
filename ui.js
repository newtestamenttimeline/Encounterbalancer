const UI = (() => {

  let monsterRows = [], pcRows = [], mIdCtr = 0, pcIdCtr = 0;
  let watchEvents = [], watchIdx = 0, watchTimer = null, watchSpeed = 500;

  // ── Event → transcript text ───────────────────────────────
  function eventToText(ev) {
    const em = (name) => {
      const m = ev.state.monsters.find(x => x.name === name); if (m) return m.em;
      const p = ev.state.party.find(x => x.name === name);    return p ? p.em : '';
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
      case 'special':       return `  ${em(ev.attacker)} ${ev.attacker} uses ${ev.ability}! → ${ev.targets.map((t, i) => `${em(t)}${t}:${ev.dmg[i]}dmg`).join(', ')}`;
      case 'friendly_fire': return `    Friendly fire ${em(ev.target)} ${ev.target}: ${ev.dmg}dmg`;
      case 'surge':         return `  ⚡ ${ev.caster}: ACTION SURGE`;
      case 'sneak':         return `  🗡️ Rogue: SNEAK ATTACK +${ev.bonus}`;
      case 'down':          return `  ${em(ev.name)} ${ev.name}: DOWN`;
      case 'death':         return `  ${em(ev.name)} ${ev.name}: DEAD`;
      case 'recovery':      return `  ${em(ev.name)} ${ev.name}: miraculous recovery`;
      case 'stabilized':    return `  ${em(ev.name)} ${ev.name}: stabilized`;
      default:              return '';
    }
  }

  // ── HP bar color ──────────────────────────────────────────
  function hpColor(pct) {
    return pct > 0.5 ? '#639922' : pct > 0.25 ? '#BA7517' : '#A32D2D';
  }

  // ── Build combatant widget ────────────────────────────────
  function makeCombatant(em, chp, maxHp, dead, down, isDeathFlash, isHit, isCrit, actionEm) {
    if (dead && !isDeathFlash) return null;
    const wrap = document.createElement('div'); wrap.className = 'combatant';
    const emEl = document.createElement('div'); emEl.className = 'combatant-em';
    if (isDeathFlash) {
      emEl.textContent = em + '💀';
    } else {
      let label = em;
      if (isHit)    label += isCrit ? '💥💥' : '💥';
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

  // ── Derive melee clusters from snapshot state ─────────────
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
        // Pull back-zone PC into cluster if this monster is targeting them
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

  // ── Action emoji from event type ──────────────────────────
  function getActionEmoji(ev) {
    if (!ev) return null;
    if (ev.type === 'attack')                       return '⚔️';
    if (ev.type === 'spell' || ev.type === 'cantrip') return '✨';
    if (ev.type === 'heal')                         return '💚';
    if (ev.type === 'special')                      return '🔥';
    return null;
  }

  // ── Render battlefield ────────────────────────────────────
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

    // Find attacker's cluster index
    let attackerClusterIdx = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].monsters.find(m => m.name === attacker) ||
          clusters[i].pcs.find(p => p.name === attacker)) {
        attackerClusterIdx = i; break;
      }
    }
    const attackerInBack = attacker && backPCs.find(p => p.name === attacker);

    // Melee section
    const meleeSection = document.createElement('div'); meleeSection.className = 'bf-section';
    const ml = document.createElement('div'); ml.className = 'bf-label'; ml.textContent = 'Melee';
    meleeSection.appendChild(ml);
    const clustersDiv = document.createElement('div'); clustersDiv.className = 'bf-clusters';

    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      const cd = document.createElement('div'); cd.className = 'bf-cluster';

      // Monster row (top)
      const mrow = document.createElement('div'); mrow.className = 'bf-row';
      for (const m of cluster.monsters) {
        const isDeath = deathTarget === m.name;
        const isAttkr = attacker === m.name && ci === attackerClusterIdx;
        const cw = makeCombatant(m.em, m.chp, m.hp, m.dead, false, isDeath, hitTarget === m.name && !isDeath, critTarget === m.name, isAttkr ? actionEm : null);
        if (cw) mrow.appendChild(cw);
      }
      cd.appendChild(mrow);

      // Action row (middle)
      const ar = document.createElement('div'); ar.className = 'bf-action-row';
      if (ci === attackerClusterIdx && actionEm) ar.textContent = actionEm;
      cd.appendChild(ar);

      // PC row (bottom)
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

    // Back section
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

  // ── Monster builder ───────────────────────────────────────
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
      return `

        

          ${em} ${m.boss ? 'Boss' : 'Minion'}${m.boss ? 'boss' : 'minion'}
          ${!m.boss ? `Remove` : ''}
        

        

          
Name
${m.name || (m.boss ? 'Boss' : 'Minion')}

          
AC

          
HP

          
Atk bonus

          
Damage
${m.dmg || (m.boss ? '1d8+2' : '1d6+2')}

          
Attacks

          
Type
Melee

        

        ${m.boss ? `
        
Special ability — optional

        

          
Name (blank = none)
${m.saname || ''}

          
Damage
${m.sadmg || '2d6+2'}

          
Save DC (0=auto)

          
Targets
Melee zone

          
Every N rounds

        
` : ''}
      
`;
    }).join('');
  }

  // ── Party builder ─────────────────────────────────────────
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
    if (!pcRows.length) { el.innerHTML = '
No PCs.
'; return; }
    el.innerHTML = pcRows.map(p => `
      

        
Class
          
${DATA.CLASS_EMOJI[c.cls]} ${c.name}

        

        
Zone
          
Melee

        

        
Override AC
auto

        
Override HP
auto

        ×
      
`).join('');
  }

  // ── Read form values ──────────────────────────────────────
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

  // ── Run simulations ───────────────────────────────────────
  function runSims() {
    const mCfgs = readMonsters();
    const lvl = +document.getElementById('plevel').value;
    const N   = +document.getElementById('nsims').value || 100;
    if (!pcRows.length) { document.getElementById('output').innerHTML = '
Add at least one PC.
'; return; }
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
    const partyDesc    = pcRows.map(p => { const def = DATA.CLASSES.find(c => c.cls === p.cls); return `${DATA.CLASS_EMOJI[p.cls] || ''} ${def.name}${p.zone}`; }).join(' ');
    const encounterDesc = readMonsters().map(m => `${m.boss ? DATA.MONSTER_EMOJI.boss : DATA.MONSTER_EMOJI.minion} ${m.name}`).join(' + ');
    document.getElementById('output').innerHTML = `
      

        
${encounterDesc} vs level ${lvl} party — ${N} simulations

        
${partyDesc}

        

          
${pwPct}%Party win rate

          
${wins}W / ${N - wins}LRecord

          
${ar}Avg rounds

          
${ad}Avg deaths

        

      
`;
  }

  // ── Watch fight ───────────────────────────────────────────
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
      

      
...

      

        Pause
        ← Step
        Step →
        
Speed:
          
Normal

        

        1 / ${watchEvents.length}
      

      
Show full transcript
`;
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
        el.textContent = line || '·'; el.classList.remove('fade');
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

  // ── Save / Load ───────────────────────────────────────────
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

  // ── Public API ────────────────────────────────────────────
  return {
    addMonster, removeMonster,
    addPC, removePC, updatePC,
    runSims, watchFight,
    toggleWatch, stepWatch, setSpeed,
    saveEncounter, loadEncounter,
  };

})();
