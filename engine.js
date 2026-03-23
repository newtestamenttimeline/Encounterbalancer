const ENGINE = (() => {

  // ── Dice ──────────────────────────────────────────────────
  function roll(n) { return Math.floor(Math.random() * n) + 1; }
  function rollN(n, d) { let t = 0; for (let i = 0; i < n; i++) t += roll(d); return t; }

  function parseDmg(s) {
    const m = s.trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!m) return () => 4;
    const [, n, d, mod] = m, b = mod ? parseInt(mod) : 0;
    return () => { let t = 0; for (let i = 0; i < +n; i++) t += roll(+d); return Math.max(1, t + b); };
  }

  // ── PC stat derivation ────────────────────────────────────
  function hpForClass(cls, lvl) {
    const die = DATA.CLASSES.find(c => c.cls === cls)?.hpDie || 8, con = 2;
    return die + con + (lvl - 1) * Math.floor(die / 2 + 1 + con);
  }
  function acForLevel(base, lvl)  { return base + Math.floor(lvl / 4); }
  function atkForLevel(base, lvl) { return base + Math.floor(lvl / 3); }
  function extraAtks(cls, lvl) {
    if (cls === 'fighter') return lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1;
    if (['paladin', 'ranger', 'barbarian'].includes(cls)) return lvl >= 5 ? 2 : 1;
    return 1;
  }
  function sneakDmg(lvl) { return rollN(Math.ceil(lvl / 2), 6); }

  // ── Build a PC object from config + level ────────────────
  function buildPC(pcCfg, lvl) {
    const def = DATA.CLASSES.find(c => c.cls === pcCfg.cls) || DATA.CLASSES[0];
    const hp  = pcCfg.hpOverride  || hpForClass(pcCfg.cls, lvl);
    const ac  = pcCfg.acOverride  || acForLevel(def.ac, lvl);
    const sl  = DATA.slotLvl(pcCfg.cls, lvl);
    const allSpells = DATA.SPELLS[pcCfg.cls] || null;
    const spells    = allSpells ? allSpells.filter(s => s.minLvl <= lvl) : null;
    return {
      name: def.name, cls: pcCfg.cls, zone: pcCfg.zone,
      em:   DATA.CLASS_EMOJI[pcCfg.cls] || '',
      hp, maxHp: hp, chp: hp, ac,
      atk:      atkForLevel(def.atkMod, lvl),
      dmgDie:   def.dmgDie,
      dmgBonus: def.dmgBonus,
      atts:     extraAtks(pcCfg.cls, lvl),
      slots:    spells && spells.length ? DATA.spellSlots(pcCfg.cls, lvl) : 0,
      spells, sl, lvl,
      cantrip:  DATA.CANTRIPS[pcCfg.cls] || null,
      isHealer: ['cleric', 'druid'].includes(pcCfg.cls),
      healUsed: false, surgeUsed: false,
      down: false, dead: false, deathSucc: 0, deathFail: 0,
    };
  }

  // ── Lightweight state snapshot attached to each event ────
  function snapshot(monsters, party) {
    return {
      monsters: monsters.map(m => ({
        name: m.name, em: m.em, chp: m.chp, hp: m.hp,
        dead: m.dead, boss: m.boss,
        meleePCs:   [...m.meleePCs],
        targetName: m.target ? m.target.name : null,
        targetZone: m.target ? m.target.zone : null,
      })),
      party: party.map(p => ({
        name: p.name, em: p.em, chp: p.chp, maxHp: p.maxHp,
        dead: p.dead, down: p.down, zone: p.zone,
      })),
    };
  }

  // ── PC action ─────────────────────────────────────────────
  function pcAct(pc, livingM, party, emit) {
    if (pc.dead || pc.down) return;
    if (!livingM().length) return;

    // Heal (full action — return immediately after)
    if (pc.isHealer && !pc.healUsed) {
      const downed  = party.filter(p => p.down && !p.dead);
      const wounded = party.filter(p => !p.dead && !p.down && p.chp < p.maxHp * 0.4);
      const ht = downed[0] || wounded.sort((a, b) => a.chp - b.chp)[0];
      if (ht) {
        const amt = roll(8) + 3;
        ht.chp = Math.min(ht.maxHp, ht.chp + amt);
        if (ht.down) { ht.down = false; ht.deathSucc = 0; ht.deathFail = 0; }
        pc.healUsed = true;
        emit({ type:'heal', healer:pc.name, target:ht.name, amt });
        return;
      }
    }

    const primaryTgt = () => livingM().sort((a, b) => b.chp - a.chp)[0];
    let tgt = livingM().find(m => m.target === pc) || primaryTgt();
    if (!tgt || tgt.dead) tgt = primaryTgt();
    if (!tgt) return;

    // Action Surge
    let atts = pc.atts;
    if (pc.cls === 'fighter' && !pc.surgeUsed && livingM().some(m => m.chp < m.hp * 0.5)) {
      atts *= 2; pc.surgeUsed = true;
      emit({ type:'surge', caster:pc.name });
    }

    // Leveled spell
    if (pc.spells && pc.spells.length && pc.slots > 0) {
      const spell = pc.spells[Math.floor(Math.random() * pc.spells.length)];
      pc.slots--;
      let dmg = spell.dmg(pc.sl, pc.lvl);
      const saved = spell.save > 0 && (roll(20) + 2 >= spell.save);
      if (saved) dmg = Math.floor(dmg / 2);
      tgt.chp -= dmg;
      if (tgt.chp <= 0) tgt.dead = true;
      emit({ type:'spell', caster:pc.name, spell:spell.name, target:tgt.name, hit:true, saved, dmg });
      if (spell.aoe && spell.zone === 'melee') {
        for (const t of party.filter(p => !p.dead && !p.down && p.zone === 'melee' && p !== pc)) {
          const ffd = Math.floor(spell.dmg(pc.sl, pc.lvl) / 2);
          t.chp -= ffd;
          emit({ type:'friendly_fire', target:t.name, dmg:ffd });
        }
      }
      tgt.target = pc;
      return;
    }

    // Cantrip fallback
    if (pc.cantrip && pc.spells) {
      const c = pc.cantrip, dmg = c.dmg(pc.lvl);
      if (c.type === 'attack') {
        const ar = roll(20) + pc.atk, crit = ar - pc.atk === 20;
        if (ar >= tgt.ac || crit) {
          const total = crit ? dmg + c.dmg(pc.lvl) : dmg;
          tgt.chp -= total; if (tgt.chp <= 0) tgt.dead = true;
          emit({ type:'cantrip', caster:pc.name, spell:c.name, target:tgt.name, hit:true, crit, dmg:total });
          tgt.target = pc;
        } else {
          emit({ type:'cantrip', caster:pc.name, spell:c.name, target:tgt.name, hit:false, crit:false, dmg:0 });
        }
      } else {
        const sv = roll(20) + 2;
        if (sv < c.dc) {
          tgt.chp -= dmg; if (tgt.chp <= 0) tgt.dead = true;
          emit({ type:'cantrip', caster:pc.name, spell:c.name, target:tgt.name, hit:true, crit:false, dmg });
          tgt.target = pc;
        } else {
          emit({ type:'cantrip', caster:pc.name, spell:c.name, target:tgt.name, hit:false, crit:false, dmg:0 });
        }
      }
      return;
    }

    // Weapon attacks
    for (let a = 0; a < atts; a++) {
      if (!livingM().length) break;
      if (tgt.dead) { tgt = primaryTgt(); if (!tgt) break; }
      let extra = 0;
      if (pc.cls === 'rogue' && Math.random() < 0.35) {
        extra = sneakDmg(pc.lvl);
        emit({ type:'sneak', rogue:pc.name, bonus:extra });
      }
      const ar = roll(20) + pc.atk, crit = ar - pc.atk === 20;
      if (ar >= tgt.ac || crit) {
        let dmg = rollN(1, pc.dmgDie) + pc.dmgBonus;
        if (crit) dmg += rollN(1, pc.dmgDie);
        tgt.chp -= dmg + extra; if (tgt.chp <= 0) tgt.dead = true;
        emit({ type:'attack', attacker:pc.name, target:tgt.name, hit:true, crit, dmg:dmg+extra, roll:ar });
        tgt.target = pc;
      } else {
        emit({ type:'attack', attacker:pc.name, target:tgt.name, hit:false, crit:false, dmg:0, roll:ar });
      }
    }
  }

  // ── Main simulation ───────────────────────────────────────
  function simulate(mCfgs, party) {
    const monsters = mCfgs.map(m => ({
      ...m, chp: m.hp,
      dmgFn:   parseDmg(m.dmgStr),
      saDmgFn: m.saName ? parseDmg(m.saDmg) : null,
      em:      m.boss ? DATA.MONSTER_EMOJI.boss : DATA.MONSTER_EMOJI.minion,
      dead: false, target: null, meleePCs: [],
    }));

    const meleePCs = party.filter(p => p.zone === 'melee');
    meleePCs.forEach((p, i) => monsters[i % monsters.length].meleePCs.push(p.name));

    const events = [];
    let round = 0;
    const livingM = () => monsters.filter(m => !m.dead && m.chp > 0);
    const livingP = () => party.filter(p => !p.dead && !p.down && p.chp > 0);
    function emit(ev) { events.push({ ...ev, state: snapshot(monsters, party) }); }

    while (round < 200 && livingM().length > 0 && party.some(p => !p.dead)) {
      round++;
      emit({ type:'round_start', round });
      const allLiving = livingP();

      // Monster turns
      for (const m of livingM()) {
        let myMelee = allLiving.filter(p => p.zone === 'melee' && m.meleePCs.includes(p.name));
        if (!myMelee.length) myMelee = allLiving.filter(p => p.zone === 'melee');
        const pool = myMelee.length ? myMelee : allLiving.filter(p => p.zone === 'back');
        if (!pool.length) continue;
        if (!m.target || m.target.dead || m.target.down || m.target.chp <= 0)
          m.target = pool.slice().sort((a, b) => b.chp - a.chp)[0];

        // Special ability
        if (m.saName && round % m.saEvery === 0) {
          const targets = m.saZone === 'all' ? allLiving
            : m.saZone === 'melee' ? allLiving.filter(p => p.zone === 'melee')
            : allLiving.filter(p => p.zone === 'back');
          const dmgs = targets.map(t => {
            let d = m.saDmgFn();
            if (m.saDC > 0 && roll(20) + 2 >= m.saDC) d = Math.floor(d / 2);
            t.chp -= d;
            return d;
          });
          emit({ type:'special', attacker:m.name, ability:m.saName, targets:targets.map(t=>t.name), dmg:dmgs });
        }

        // Normal attacks
        let attsThisTurn = m.atts;
        if (m.type === 'melee' && round === 1) attsThisTurn = Math.max(1, attsThisTurn - 1);
        for (let a = 0; a < attsThisTurn; a++) {
          if (!m.target || m.target.dead || m.target.down || m.target.chp <= 0) break;
          const ar = roll(20) + m.atk, crit = ar - m.atk === 20;
          if (ar >= m.target.ac || crit) {
            let dmg = m.dmgFn(); if (crit) dmg += m.dmgFn();
            m.target.chp -= dmg;
            emit({ type:'attack', attacker:m.name, target:m.target.name, hit:true, crit, dmg, roll:ar });
          } else {
            emit({ type:'attack', attacker:m.name, target:m.target.name, hit:false, crit:false, dmg:0, roll:ar });
          }
        }
      }

      // Death saves
      for (const p of party) {
        if (p.chp <= 0 && !p.down && !p.dead) { p.down = true; p.chp = 0; emit({ type:'down', name:p.name }); }
        if (p.down && !p.dead) {
          const ds = roll(20);
          if (ds === 20) {
