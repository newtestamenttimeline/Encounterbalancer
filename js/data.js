const DATA = (() => {

  const CLASS_EMOJI = {
    fighter:'⚔️', barbarian:'🪓', paladin:'🛡️', rogue:'🗡️', ranger:'🏹',
    cleric:'✨', druid:'🌿', wizard:'🔮', sorcerer:'💫', bard:'🎵', warlock:'👁️',
  };

  const MONSTER_EMOJI = { boss:'💀', minion:'👺' };
  const ATTACK_EMOJI  = { melee:'⚔️', ranged:'🏹', magic:'✨' };

  const CLASS_ATTACK_TYPE = {
    fighter:'melee', barbarian:'melee', paladin:'melee', rogue:'melee',
    ranger:'ranged', cleric:'magic', druid:'magic', wizard:'magic',
    sorcerer:'magic', bard:'magic', warlock:'magic',
  };

  const CLASSES = [
    { name:'Fighter',   zone:'melee', hpDie:10, ac:16, atkMod:3, dmgDie:8,  dmgBonus:3, cls:'fighter'  },
    { name:'Barbarian', zone:'melee', hpDie:12, ac:15, atkMod:4, dmgDie:12, dmgBonus:4, cls:'barbarian' },
    { name:'Paladin',   zone:'melee', hpDie:10, ac:17, atkMod:3, dmgDie:8,  dmgBonus:3, cls:'paladin'  },
    { name:'Rogue',     zone:'melee', hpDie:8,  ac:14, atkMod:4, dmgDie:6,  dmgBonus:3, cls:'rogue'    },
    { name:'Ranger',    zone:'back',  hpDie:10, ac:15, atkMod:3, dmgDie:8,  dmgBonus:3, cls:'ranger'   },
    { name:'Cleric',    zone:'back',  hpDie:8,  ac:16, atkMod:3, dmgDie:8,  dmgBonus:2, cls:'cleric'   },
    { name:'Druid',     zone:'back',  hpDie:8,  ac:13, atkMod:3, dmgDie:8,  dmgBonus:2, cls:'druid'    },
    { name:'Wizard',    zone:'back',  hpDie:6,  ac:12, atkMod:4, dmgDie:10, dmgBonus:3, cls:'wizard'   },
    { name:'Sorcerer',  zone:'back',  hpDie:6,  ac:12, atkMod:4, dmgDie:10, dmgBonus:3, cls:'sorcerer' },
    { name:'Bard',      zone:'back',  hpDie:8,  ac:13, atkMod:3, dmgDie:8,  dmgBonus:2, cls:'bard'     },
    { name:'Warlock',   zone:'back',  hpDie:8,  ac:13, atkMod:4, dmgDie:10, dmgBonus:4, cls:'warlock'  },
  ];

  const FULL_SLOT = [0, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7];
  const HALF_SLOT = [0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4];

  function slotLvl(cls, lvl) {
    return ['paladin', 'ranger'].includes(cls) ? HALF_SLOT[lvl] : FULL_SLOT[lvl];
  }

  function spellSlots(cls, lvl) {
    if (cls === 'warlock') return Math.min(4, Math.ceil(lvl / 2));
    return [0, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7][lvl] || 2;
  }

  // Note: cantrip dmg functions reference ENGINE.rollN — loaded after data.js
  const CANTRIPS = {
    wizard:   { name:'Fire Bolt',       type:'attack', dc:0,  dmg:(lvl) => ENGINE.rollN(lvl >= 5 ? 2 : 1, 10)     },
    sorcerer: { name:'Fire Bolt',       type:'attack', dc:0,  dmg:(lvl) => ENGINE.rollN(lvl >= 5 ? 2 : 1, 10)     },
    warlock:  { name:'Eldritch Blast',  type:'attack', dc:0,  dmg:(lvl) => ENGINE.rollN(lvl >= 5 ? 2 : 1, 10) + 3 },
    cleric:   { name:'Sacred Flame',    type:'save',   dc:13, dmg:(lvl) => ENGINE.rollN(lvl >= 5 ? 2 : 1, 8)      },
    druid:    { name:'Produce Flame',   type:'attack', dc:0,  dmg:(lvl) => ENGINE.rollN(lvl >= 5 ? 2 : 1, 8)      },
    bard:     { name:'Vicious Mockery', type:'save',   dc:13, dmg:(lvl) => ENGINE.rollN(lvl >= 5 ? 2 : 1, 4)      },
  };

  const SPELLS = {
    wizard: [
      { name:'Magic Missile',  minLvl:1, aoe:false, zone:null,    save:0,  dmg:(sl)    => { let t=0; for(let i=0;i<2+sl;i++) t+=ENGINE.roll(4)+1; return t; } },
      { name:'Scorching Ray',  minLvl:3, aoe:false, zone:null,    save:0,  dmg:(sl)    => ENGINE.rollN((sl+1)*2, 6) },
      { name:'Fireball',       minLvl:5, aoe:true,  zone:'melee', save:13, dmg:(sl)    => ENGINE.rollN(5+sl, 6)    },
    ],
    sorcerer: [
      { name:'Chromatic Orb',  minLvl:1, aoe:false, zone:null,    save:0,  dmg:(sl)    => ENGINE.rollN(2+sl, 8)   },
      { name:'Scorching Ray',  minLvl:3, aoe:false, zone:null,    save:0,  dmg:(sl)    => ENGINE.rollN((sl+1)*2, 6) },
      { name:'Fireball',       minLvl:5, aoe:true,  zone:'melee', save:13, dmg:(sl)    => ENGINE.rollN(5+sl, 6)    },
    ],
    druid: [
      { name:'Thunderwave',    minLvl:1, aoe:true,  zone:'melee', save:13, dmg:(sl)    => ENGINE.rollN(sl*2, 8)   },
      { name:'Moonbeam',       minLvl:3, aoe:false, zone:null,    save:13, dmg:(sl)    => ENGINE.rollN(sl, 10)     },
      { name:'Call Lightning', minLvl:5, aoe:false, zone:null,    save:13, dmg:(sl)    => ENGINE.rollN(sl, 10)     },
    ],
    cleric: [
      { name:'Guiding Bolt',     minLvl:1, aoe:false, zone:null,    save:0,  dmg:(sl) => ENGINE.rollN(3+sl, 6)                         },
      { name:'Spiritual Weapon', minLvl:3, aoe:false, zone:null,    save:0,  dmg:(sl) => ENGINE.rollN(Math.floor(sl/2)+1, 8) + 3        },
      { name:'Spirit Guardians', minLvl:5, aoe:true,  zone:'melee', save:13, dmg:(sl) => ENGINE.rollN(sl, 8)                           },
    ],
    bard: [
      { name:'Dissonant Whispers', minLvl:1, aoe:false, zone:null,    save:13, dmg:(sl) => ENGINE.rollN(2+sl, 6) },
      { name:'Shatter',            minLvl:3, aoe:true,  zone:'melee', save:13, dmg:(sl) => ENGINE.rollN(1+sl, 8) },
      { name:'Hypnotic Pattern',   minLvl:5, aoe:false, zone:null,    save:14, dmg:()   => 0                     },
    ],
    warlock: [
      { name:'Eldritch Blast',   minLvl:1, aoe:false, zone:null,    save:0,  dmg:(sl,cl) => ENGINE.rollN(cl>=5?2:1,10) + (cl>=5?6:3) },
      { name:'Hunger of Hadar',  minLvl:5, aoe:true,  zone:'melee', save:13, dmg:(sl)    => ENGINE.rollN(sl,6) + ENGINE.rollN(sl,6)   },
    ],
    paladin: [
      { name:'Divine Smite',     minLvl:1, aoe:false, zone:null, save:0,  dmg:(sl) => ENGINE.rollN(sl+1, 8) },
      { name:'Thunderous Smite', minLvl:3, aoe:false, zone:null, save:13, dmg:(sl) => ENGINE.rollN(sl, 6)   },
    ],
    ranger: [
      { name:"Hunter's Mark",  minLvl:1, aoe:false, zone:null, save:0,  dmg:()   => ENGINE.roll(6)        },
      { name:'Hail of Thorns', minLvl:3, aoe:false, zone:null, save:13, dmg:(sl) => ENGINE.rollN(sl, 10)  },
    ],
  };

  return {
    CLASS_EMOJI, MONSTER_EMOJI, ATTACK_EMOJI, CLASS_ATTACK_TYPE,
    CLASSES, CANTRIPS, SPELLS, slotLvl, spellSlots,
  };

})();
