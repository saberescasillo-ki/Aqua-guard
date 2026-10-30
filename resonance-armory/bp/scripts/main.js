// scripts/armory/coal/smoke_club.ts
import { world, system as system4, EntityDamageCause, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";

// scripts/systems/cooldown.ts
import { system } from "@minecraft/server";
var cooldowns = /* @__PURE__ */ new Map();
function isOnCooldown(entity, key) {
  const until = cooldowns.get(`${entity.id}:${key}`);
  return until !== void 0 && system.currentTick < until;
}
function withCooldown(entity, key, ticks, action) {
  if (isOnCooldown(entity, key)) return;
  cooldowns.set(`${entity.id}:${key}`, system.currentTick + ticks);
  try {
    action();
  } catch (e) {
    console.warn(`[Resonance] ${key}: ${e}`);
  }
}
function clearCooldowns(entity) {
  const prefix = `${entity.id}:`;
  for (const k of [...cooldowns.keys()]) if (k.startsWith(prefix)) cooldowns.delete(k);
  try {
    for (const tag of entity.getTags()) if (tag.startsWith("cd_")) entity.removeTag(tag);
  } catch {
  }
}

// scripts/systems/vanilla_hit.ts
var RESONANCE_WEAPONS = [
  "resonance:smoke_club",
  "resonance:iron_halberd",
  "resonance:golden_rapier",
  "resonance:copper_hammer",
  "resonance:diamond_greatsword",
  "resonance:netherite_relic_blade",
  "resonance:redstone_pulse_gauntlet",
  "resonance:lunar_crescent"
];
var scriptedDamageDepth = 0;
function dealDamage(target, amount, options) {
  scriptedDamageDepth++;
  try {
    return target.applyDamage(amount, options);
  } finally {
    scriptedDamageDepth--;
  }
}
function isHoldingResonanceWeapon(player) {
  try {
    const id = player.getComponent("minecraft:equippable")?.getEquipment("Mainhand")?.typeId;
    return !!id && RESONANCE_WEAPONS.includes(id);
  } catch {
    return false;
  }
}
var weaponHitHandlers = [];
var lastHitDispatchTick = /* @__PURE__ */ new Map();
function onWeaponHit(handler) {
  weaponHitHandlers.push(handler);
}
function dispatchWeaponHit(ev) {
  const attacker = ev.damagingEntity;
  if (!attacker || !ev.hitEntity) return;
  if (lastHitDispatchTick.get(attacker.id) === system.currentTick) return;
  lastHitDispatchTick.set(attacker.id, system.currentTick);
  for (const handler of weaponHitHandlers) {
    try {
      handler(ev);
    } catch (e) {
      console.warn(`[Resonance] hit: ${e}`);
    }
  }
}
world.afterEvents.entityHitEntity.subscribe(dispatchWeaponHit);
world.beforeEvents.entityHurt.subscribe((ev) => {
  if (scriptedDamageDepth > 0) return;
  const attacker = ev.damageSource.damagingEntity;
  if (!attacker || attacker.typeId !== "minecraft:player" || ev.damageSource.damagingProjectile) return;
  if (!isHoldingResonanceWeapon(attacker)) return;
  ev.cancel = true;
  const hitEntity = ev.hurtEntity;
  system.run(() => {
    const last = lastHitDispatchTick.get(attacker.id);
    if (last !== void 0 && system.currentTick - last <= 1) return;
    try {
      if (attacker.isValid && hitEntity.isValid) dispatchWeaponHit({ damagingEntity: attacker, hitEntity });
    } catch {
    }
  });
}, { allowedDamageCauses: [EntityDamageCause.entityAttack] });

// scripts/utils/area_effect.ts
function applyAreaEffect(dimension, center, radius, effects, source) {
  const entities = dimension.getEntities({
    location: center,
    maxDistance: radius,
    excludeTypes: ["minecraft:item", "minecraft:xp_orb"]
  });
  for (const entity of entities) {
    if (source && entity.id === source.id) continue;
    for (const effect of effects) {
      try {
        entity.addEffect(effect.type, effect.duration, {
          amplifier: effect.level ?? 0,
          showParticles: false
        });
      } catch {
      }
    }
  }
}

// scripts/utils/particles.ts
function spawnSmoke(dimension, center, count = 5) {
  for (let i = 0; i < count; i++) {
    dimension.spawnParticle("minecraft:campfire_smoke_particle", {
      x: center.x + Math.random() - 0.5,
      y: center.y,
      z: center.z + Math.random() - 0.5
    });
  }
}

// scripts/utils/safe_tick.ts
function safeTick(fn) {
  return (player) => {
    try {
      fn(player);
    } catch (e) {
      console.warn(`[Resonance] ${fn.name}: ${e}`);
    }
  };
}

// scripts/utils/input_lock.ts
import { InputPermissionCategory, system as system2 } from "@minecraft/server";
function disableMovement(player) {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
  } catch {
    try {
      player.addEffect("slowness", 3, { amplifier: 255, showParticles: false });
    } catch {
    }
  }
}
function enableMovement(player) {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
  } catch {
  }
}
var activeInputLocks = /* @__PURE__ */ new Map();
function releaseExpiredInputLocks() {
  const tick = system2.currentTick;
  for (const player of world.getPlayers()) {
    const until = activeInputLocks.get(player.id);
    if (until === void 0 || tick < until) continue;
    activeInputLocks.delete(player.id);
    enableMovement(player);
  }
}
function lockInputAndSuppressVanilla(player, durationTicks, state) {
  const until = system2.currentTick + Math.max(1, durationTicks);
  activeInputLocks.set(player.id, Math.max(activeInputLocks.get(player.id) ?? 0, until));
  state.inputLockUntilTick = Math.max(state.inputLockUntilTick ?? 0, until);
  try {
    disableMovement(player);
    state.inputLocked = true;
  } catch {
    state.inputLocked = false;
  }
}
function maintainOrReleaseInputLock(player, state) {
  const tick = system2.currentTick;
  if (state.inputLockUntilTick && tick < state.inputLockUntilTick) {
    if (state.inputLocked)
      try {
        disableMovement(player);
      } catch {
      }
    return;
  }
  if (state.inputLocked)
    try {
      enableMovement(player);
    } catch {
    }
  state.inputLocked = false;
  state.inputLockUntilTick = 0;
}

// scripts/systems/targeting.ts
var NON_TARGET_TYPES = ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:armor_stand", "minecraft:painting", "minecraft:leash_knot"];
function safeHit(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch {
    }
  };
}
function getTargetsInCone(player, range, coneDeg, maxTargets) {
  const dim = player.dimension;
  if (!dim?.getEntities) return [];
  const origin = player.location;
  const view = player.getViewDirection();
  const flatLen = Math.sqrt(view.x * view.x + view.z * view.z);
  const forward = flatLen > 1e-3 ? { x: view.x / flatLen, z: view.z / flatLen } : { x: 0, z: 1 };
  const cosThreshold = Math.cos(coneDeg * Math.PI / 180 / 2);
  const list = dim.getEntities({ location: origin, maxDistance: range + 1, excludeTypes: NON_TARGET_TYPES }) || [];
  const results = [];
  for (const e of list) {
    try {
      if (!e || !e.isValid || e.id === player.id || !e.location) continue;
      const health = e.getComponent("minecraft:health");
      if (!health || health.currentValue <= 0) continue;
      if (e.getComponent("minecraft:tameable")?.tamedToPlayerId === player.id) continue;
      if (Math.abs(e.location.y - origin.y) > 2.5) continue;
    } catch {
      continue;
    }
    const dx = e.location.x - origin.x;
    const dz = e.location.z - origin.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= 0.01 || dist > range) continue;
    const dot = forward.x * (dx / dist) + forward.z * (dz / dist);
    if (dot >= cosThreshold) {
      results.push(e);
      if (results.length >= maxTargets) break;
    }
  }
  return results;
}

// scripts/systems/combo.ts
import { system as system3 } from "@minecraft/server";
var ATTACKING_FLAG = "attacking";
var ATTACK_BLEND_OUT_SECONDS = 0.3;
function resetAttackingFlagIfNeeded(player, state) {
  if (state.attackingFlagUntil > 0 && system3.currentTick >= state.attackingFlagUntil) {
    player.setDynamicProperty(ATTACKING_FLAG, 0);
    state.attackingFlagUntil = 0;
  }
}
function startAttack(player, state, cfg, setState9) {
  const tick = system3.currentTick;
  if (!state.isAttacking && tick - state.lastAttackTick > cfg.comboResetTicks) state.comboIndex = 0;
  const anim = cfg.anims[state.comboIndex % cfg.anims.length];
  state.isAttacking = true;
  state.frame = 0;
  state.bufferedNext = false;
  state.lastAttackTick = tick;
  state.lockUntilTick = tick + anim.nextAttackWindow;
  player.setDynamicProperty(ATTACKING_FLAG, 1);
  state.attackingFlagUntil = tick + cfg.attackLockTicks;
  lockInputAndSuppressVanilla(player, anim.attackTime + cfg.inputCooldownTicks + 2, state);
  player.playAnimation(anim.animation, { controller: cfg.animController, blendOutTime: cfg.blendOutSeconds ?? ATTACK_BLEND_OUT_SECONDS });
  setState9(player, state);
}
function bufferNextAttack(player, state, setState9) {
  state.bufferedNext = true;
  setState9(player, state);
}
var RESET_ANIMATION = "animation.resonance.reset";
function endAttackAnimation(player, cfg) {
  try {
    player.playAnimation(RESET_ANIMATION, { controller: cfg.animController, blendOutTime: 0 });
  } catch {
  }
}
function handleComboTransitionOrEnd(player, state, cfg, setState9) {
  const tick = system3.currentTick;
  const anim = cfg.anims[state.comboIndex % cfg.anims.length];
  if (state.bufferedNext && tick >= state.lockUntilTick && state.frame >= anim.cancelIntoNextTick) {
    state.bufferedNext = false;
    state.comboIndex = (state.comboIndex + 1) % cfg.anims.length;
    setState9(player, state);
    startAttack(player, state, cfg, setState9);
    return "cancel";
  }
  if (state.frame >= anim.attackTime) {
    endAttackAnimation(player, cfg);
    state.isAttacking = false;
    state.frame = 0;
    state.bufferedNext = false;
    setState9(player, state);
    return "end";
  }
  setState9(player, state);
  return "continue";
}

// scripts/armory/coal/smoke_club.ts
var WEAPON_ID = "resonance:smoke_club";
var BASE_DAMAGE = 8;
var INPUT_COOLDOWN_TICKS = 2;
var COMBO_RESET_TICKS = 40;
var ATTACK_LOCK_TICKS = 2;
var ANIM_CONTROLLER = "controller.animation.smoke_club";
var SPECIAL_COOLDOWN_TICKS = 40;
var SMOKE_PARTICLE_COUNT = 6;
var SMOKE_RADIUS = 1.5;
var SMOKE_EFFECTS = [
  { type: "blindness", duration: 38, level: 1 },
  { type: "slowness", duration: 40, level: 1 }
];
var ANIMS = [
  {
    animation: "animation.smoke_club.attack",
    attackTime: 33,
    nextAttackWindow: 6,
    cancelIntoNextTick: 14,
    hitFrames: [12, 13],
    range: 2.8,
    coneDeg: 75,
    damageMultiplier: 1,
    specialFrame: 12
  },
  {
    animation: "animation.smoke_club.attack1",
    attackTime: 33,
    nextAttackWindow: 6,
    cancelIntoNextTick: 14,
    hitFrames: [12, 13],
    range: 3.2,
    coneDeg: 80,
    damageMultiplier: 1.15,
    specialFrame: 12
  },
  {
    animation: "animation.smoke_club.attack2",
    attackTime: 33,
    nextAttackWindow: 10,
    cancelIntoNextTick: 14,
    hitFrames: [12, 13],
    range: 3,
    coneDeg: 85,
    damageMultiplier: 1.35,
    specialFrame: 12
  }
];
var COMBO_CFG = {
  anims: ANIMS,
  animController: ANIM_CONTROLLER,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS,
  attackLockTicks: ATTACK_LOCK_TICKS,
  comboResetTicks: COMBO_RESET_TICKS
};
var STATE_KEY = "res_smoke_club_state";
var DEFAULT_STATE = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false,
  specialTriggeredThisSwing: false
};
var getState = (p) => {
  const r = p.getDynamicProperty(STATE_KEY);
  return r ? JSON.parse(r) : { ...DEFAULT_STATE };
};
var setState = (p, s) => p.setDynamicProperty(STATE_KEY, JSON.stringify(s));
function isHoldingWeapon(player) {
  const eq = player.getComponent(EntityComponentTypes.Equippable);
  if (!eq) return false;
  try {
    return eq.getEquipment(EquipmentSlot.Mainhand)?.typeId === WEAPON_ID;
  } catch {
  }
  return player.getComponent("minecraft:equippable")?.getEquipment?.("Mainhand")?.typeId === WEAPON_ID;
}
var calcDamage = (anim) => Math.floor(BASE_DAMAGE * anim.damageMultiplier);
var applyHit = safeHit((player, target, dmg) => dealDamage(target, dmg, { cause: EntityDamageCause.entityAttack, damagingEntity: player }));
function triggerSmokeSpecial(attacker, primaryTarget) {
  withCooldown(attacker, "smoke_club_special", SPECIAL_COOLDOWN_TICKS, () => {
    spawnSmoke(primaryTarget.dimension, primaryTarget.location, SMOKE_PARTICLE_COUNT);
    applyAreaEffect(primaryTarget.dimension, primaryTarget.location, SMOKE_RADIUS, [...SMOKE_EFFECTS], attacker);
  });
}
function tickWeapon(player) {
  if (!isHoldingWeapon(player)) return;
  const state = getState(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking) {
    setState(player, state);
    return;
  }
  const anim = ANIMS[state.comboIndex % ANIMS.length];
  state.frame++;
  if (state.frame === 1) {
    state.specialTriggeredThisSwing = false;
  }
  if (anim.hitFrames.includes(state.frame)) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    const dir = player.getViewDirection();
    player.applyKnockback({ x: dir.x, z: dir.z }, 0);
    if (targets.length > 0) {
      const dmg = calcDamage(anim);
      for (const t of targets) applyHit(player, t, dmg);
      const specialFrame = anim.specialFrame ?? anim.hitFrames[0];
      if (!state.specialTriggeredThisSwing && state.frame === specialFrame) {
        state.specialTriggeredThisSwing = true;
        triggerSmokeSpecial(player, targets[0]);
      }
      try {
        world.getDimension(player.dimension.id).playSound("random.fuse", targets[0].location, { volume: 0.4, pitch: 1.2 });
        player.runCommand("execute as @s run camerashake add @s 0.3 0.3");
      } catch {
      }
    }
  }
  handleComboTransitionOrEnd(player, state, COMBO_CFG, setState);
}
onWeaponHit((ev) => {
  const { damagingEntity: attacker, hitEntity: victim } = ev;
  if (!attacker || attacker.typeId !== "minecraft:player" || !victim) return;
  if (!isHoldingWeapon(attacker)) return;
  withCooldown(attacker, "smoke_club_input", INPUT_COOLDOWN_TICKS, () => {
    const s = getState(attacker);
    resetAttackingFlagIfNeeded(attacker, s);
    if (s.isAttacking) {
      bufferNextAttack(attacker, s, setState);
      return;
    }
    startAttack(attacker, s, COMBO_CFG, setState);
  });
});
system4.runInterval(() => world.getPlayers().forEach(safeTick(tickWeapon)), 1);

// scripts/armory/iron/iron_halberd.ts
import { world as world2, system as system5, EntityDamageCause as EntityDamageCause2, EntityComponentTypes as EntityComponentTypes2, EquipmentSlot as EquipmentSlot2 } from "@minecraft/server";
var WEAPON_ID2 = "resonance:iron_halberd";
var BASE_DAMAGE2 = 12;
var INPUT_COOLDOWN_TICKS2 = 2;
var COMBO_RESET_TICKS2 = 40;
var ATTACK_LOCK_TICKS2 = 2;
var ANIM_CONTROLLER2 = "res:halberd_combo";
var ARMOR_BONUS_MULTIPLIER = 0.35;
var ARMOR_BONUS_PER_ARMOR_POINT = 0.4;
var KNOCKBACK_STRENGTH = 1.4;
var KNOCKBACK_VERTICAL = 0.35;
var ANIMS2 = [
  {
    animation: "animation.iron_halberd.attack",
    attackTime: 31,
    nextAttackWindow: 6,
    cancelIntoNextTick: 20,
    hitFrames: [7, 8],
    range: 3.7,
    coneDeg: 75,
    damageMultiplier: 1
  },
  {
    animation: "animation.iron_halberd.attack1",
    attackTime: 30,
    nextAttackWindow: 6,
    cancelIntoNextTick: 20,
    hitFrames: [6],
    range: 3.3,
    coneDeg: 80,
    damageMultiplier: 1.15
  },
  {
    animation: "animation.iron_halberd.attack2",
    attackTime: 31,
    nextAttackWindow: 10,
    cancelIntoNextTick: 20,
    hitFrames: [6, 7],
    range: 3.5,
    coneDeg: 85,
    damageMultiplier: 1.35
  }
];
var COMBO_CFG2 = {
  anims: ANIMS2,
  animController: ANIM_CONTROLLER2,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS2,
  attackLockTicks: ATTACK_LOCK_TICKS2,
  comboResetTicks: COMBO_RESET_TICKS2
};
var STATE_KEY2 = "res_halberd_state";
var DEFAULT_STATE2 = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false
};
var getState2 = (p) => {
  const r = p.getDynamicProperty(STATE_KEY2);
  return r ? JSON.parse(r) : { ...DEFAULT_STATE2 };
};
var setState2 = (p, s) => p.setDynamicProperty(STATE_KEY2, JSON.stringify(s));
function isHoldingWeapon2(player) {
  const eq = player.getComponent("minecraft:equippable");
  return !!eq && eq.getEquipment?.("Mainhand")?.typeId === WEAPON_ID2;
}
function getArmorValue(target) {
  try {
    const attr = target.getComponent?.("minecraft:attribute");
    const armorAttr = attr?.getAttribute?.("minecraft:armor") ?? attr?.getAttribute?.("minecraft:armor_value") ?? null;
    if (armorAttr?.currentValue !== void 0) return Number(armorAttr.currentValue) || 0;
  } catch {
  }
  const eq = target.getComponent(EntityComponentTypes2.Equippable);
  if (!eq) return 0;
  let pieces = 0;
  for (const slot of [EquipmentSlot2.Head, EquipmentSlot2.Chest, EquipmentSlot2.Legs, EquipmentSlot2.Feet]) {
    try {
      if (eq.getEquipment(slot)) pieces++;
    } catch {
    }
  }
  return pieces * 2;
}
function calcDamage2(target, anim) {
  const armor = getArmorValue(target);
  let dmg = BASE_DAMAGE2 * anim.damageMultiplier;
  if (armor > 0) {
    dmg *= 1 + ARMOR_BONUS_MULTIPLIER;
    dmg += armor * ARMOR_BONUS_PER_ARMOR_POINT;
  }
  return Math.floor(dmg);
}
var applyHit2 = safeHit(function applyHit2(player, target, dmg) {
  dealDamage(target, dmg, { cause: EntityDamageCause2.entityAttack, damagingEntity: player });
  const dir = player.getViewDirection();
  target.applyKnockback({ x: dir.x * KNOCKBACK_STRENGTH, z: dir.z * KNOCKBACK_STRENGTH }, KNOCKBACK_VERTICAL);
});
function tickWeapon2(player) {
  if (!isHoldingWeapon2(player)) return;
  const state = getState2(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking) {
    setState2(player, state);
    return;
  }
  const anim = ANIMS2[state.comboIndex % ANIMS2.length];
  state.frame++;
  if (anim.hitFrames.includes(state.frame)) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    let hitSomething = false;
    for (const t of targets) {
      applyHit2(player, t, calcDamage2(t, anim));
      hitSomething = true;
    }
    const dir = player.getViewDirection();
    player.applyKnockback({ x: dir.x, z: dir.z }, 0);
    try {
      world2.getDimension(player.dimension.id).playSound("random.anvil_land", player.location, { volume: 0.5, pitch: 1.5 });
      if (hitSomething) player.runCommand("execute as @s run camerashake add @s 0.3 0.3");
    } catch {
    }
  }
  handleComboTransitionOrEnd(player, state, COMBO_CFG2, setState2);
}
onWeaponHit((ev) => {
  const { damagingEntity: attacker, hitEntity: victim } = ev;
  if (!attacker || attacker.typeId !== "minecraft:player" || !victim) return;
  if (!isHoldingWeapon2(attacker)) return;
  withCooldown(attacker, "iron_halberd_input", INPUT_COOLDOWN_TICKS2, () => {
    const s = getState2(attacker);
    resetAttackingFlagIfNeeded(attacker, s);
    if (s.isAttacking) {
      bufferNextAttack(attacker, s, setState2);
      return;
    }
    startAttack(attacker, s, COMBO_CFG2, setState2);
  });
});
system5.runInterval(() => world2.getPlayers().forEach(safeTick(tickWeapon2)), 1);

// scripts/armory/gold/golden_rapier.ts
import { world as world3, system as system6, EntityDamageCause as EntityDamageCause3, EntityComponentTypes as EntityComponentTypes3, EquipmentSlot as EquipmentSlot3, GameMode } from "@minecraft/server";
var WEAPON_ID3 = "resonance:golden_rapier";
var BASE_DAMAGE3 = 4;
var INPUT_COOLDOWN_TICKS3 = 2;
var COMBO_RESET_TICKS3 = 40;
var ATTACK_LOCK_TICKS3 = 2;
var ANIM_CONTROLLER3 = "res:rapier_combo";
var CRIT_CHANCE = 0.4;
var CRIT_BONUS_DAMAGE = 6;
var CRIT_COOLDOWN_TICKS = 2;
var EXTRA_DURABILITY_ON_CRIT = 1;
var ANIMS3 = [
  {
    animation: "animation.golden_rapier.attack",
    attackTime: 16,
    nextAttackWindow: 2,
    cancelIntoNextTick: 10,
    hitFrames: [4],
    range: 5.5,
    coneDeg: 70,
    damageMultiplier: 1
  },
  {
    animation: "animation.golden_rapier.attack1",
    attackTime: 20,
    nextAttackWindow: 2,
    cancelIntoNextTick: 10,
    hitFrames: [2, 3],
    range: 5.5,
    coneDeg: 75,
    damageMultiplier: 1.1
  },
  {
    animation: "animation.golden_rapier.attack2",
    attackTime: 15,
    nextAttackWindow: 3,
    cancelIntoNextTick: 5,
    hitFrames: [1, 2],
    range: 5.5,
    coneDeg: 80,
    damageMultiplier: 1.25
  }
];
var COMBO_CFG3 = {
  anims: ANIMS3,
  animController: ANIM_CONTROLLER3,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS3,
  attackLockTicks: ATTACK_LOCK_TICKS3,
  comboResetTicks: COMBO_RESET_TICKS3
};
var STATE_KEY3 = "res_rapier_state";
var DEFAULT_STATE3 = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false,
  critProcLockedUntilTick: 0
};
var getState3 = (p) => {
  const r = p.getDynamicProperty(STATE_KEY3);
  return r ? JSON.parse(r) : { ...DEFAULT_STATE3 };
};
var setState3 = (p, s) => p.setDynamicProperty(STATE_KEY3, JSON.stringify(s));
function getMainhand(player) {
  try {
    return player.getComponent(EntityComponentTypes3.Equippable)?.getEquipment(EquipmentSlot3.Mainhand) ?? null;
  } catch {
  }
  try {
    return player.getComponent("minecraft:equippable")?.getEquipment?.("Mainhand") ?? null;
  } catch {
    return null;
  }
}
var isHoldingWeapon3 = (player) => getMainhand(player)?.typeId === WEAPON_ID3;
function damageDurabilityOnCrit(player, amount) {
  if (amount <= 0) return;
  try {
    if (player.getGameMode?.() === GameMode.Creative) return;
  } catch {
  }
  const mh = getMainhand(player);
  if (!mh) return;
  try {
    const durability = mh.getComponent("minecraft:durability");
    if (!durability) return;
    const eq = player.getComponent?.(EntityComponentTypes3.Equippable) ?? player.getComponent?.("minecraft:equippable");
    if (durability.damage + amount >= durability.maxDurability) {
      eq?.setEquipment(EquipmentSlot3.Mainhand, void 0);
      try {
        player.dimension.playSound("random.break", player.location);
      } catch {
      }
      return;
    }
    durability.damage += amount;
    try {
      eq?.setEquipment(EquipmentSlot3.Mainhand, mh);
    } catch {
      try {
        eq?.setEquipment("Mainhand", mh);
      } catch {
      }
    }
  } catch {
  }
}
var calcBaseDamage = (anim) => Math.floor(BASE_DAMAGE3 * anim.damageMultiplier);
var rollCrit = () => Math.random() < CRIT_CHANCE;
var applyHit3 = safeHit((player, target, dmg) => dealDamage(target, dmg, { cause: EntityDamageCause3.entityAttack, damagingEntity: player }));
function tickWeapon3(player) {
  if (!isHoldingWeapon3(player)) return;
  const state = getState3(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking) {
    setState3(player, state);
    return;
  }
  const anim = ANIMS3[state.comboIndex % ANIMS3.length];
  state.frame++;
  if (anim.hitFrames.includes(state.frame)) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    if (targets.length > 0) {
      const baseDmg = calcBaseDamage(anim);
      const tick = system6.currentTick;
      const canCrit = tick >= (state.critProcLockedUntilTick ?? 0);
      const didCrit = canCrit && rollCrit();
      if (didCrit) state.critProcLockedUntilTick = tick + CRIT_COOLDOWN_TICKS;
      for (const t of targets) {
        applyHit3(player, t, baseDmg);
        if (didCrit)
          dealDamage(t, CRIT_BONUS_DAMAGE, { cause: EntityDamageCause3.entityAttack, damagingEntity: player });
      }
      if (didCrit) {
        damageDurabilityOnCrit(player, EXTRA_DURABILITY_ON_CRIT);
        try {
          world3.getDimension(player.dimension.id).playSound("random.levelup", player.location, { volume: 0.35, pitch: 1.8 });
        } catch {
        }
      }
    }
  }
  handleComboTransitionOrEnd(player, state, COMBO_CFG3, setState3);
}
onWeaponHit((ev) => {
  const { damagingEntity: attacker, hitEntity: victim } = ev;
  if (!attacker || attacker.typeId !== "minecraft:player" || !victim) return;
  if (!isHoldingWeapon3(attacker)) return;
  withCooldown(attacker, "golden_rapier_input", INPUT_COOLDOWN_TICKS3, () => {
    const s = getState3(attacker);
    resetAttackingFlagIfNeeded(attacker, s);
    if (s.isAttacking) {
      bufferNextAttack(attacker, s, setState3);
      return;
    }
    startAttack(attacker, s, COMBO_CFG3, setState3);
  });
});
system6.runInterval(() => world3.getPlayers().forEach(safeTick(tickWeapon3)), 1);

// scripts/armory/copper/copper_hammer.ts
import { world as world4, system as system7, EntityDamageCause as EntityDamageCause4 } from "@minecraft/server";
var WEAPON_ID4 = "resonance:copper_hammer";
var BASE_DAMAGE4 = 12;
var INPUT_COOLDOWN_TICKS4 = 2;
var COMBO_RESET_TICKS4 = 40;
var ATTACK_LOCK_TICKS4 = 2;
var ANIM_CONTROLLER4 = "res:hammer_combo";
var SHOCK_THRESHOLD = 3;
var SHOCK_MAX_STREAK = 5;
var SHOCK_COOLDOWN_TICKS = 8;
var SHOCK_DAMAGE_BASE = 2;
var SHOCK_DAMAGE_WET = 3;
var SHOCK_RADIUS_BASE = 3;
var SHOCK_RADIUS_WET = 4;
var ANIMS4 = [
  {
    animation: "animation.copper_hammer.attack",
    attackTime: 38,
    nextAttackWindow: 10,
    cancelIntoNextTick: 18,
    hitFrames: [17],
    range: 3,
    coneDeg: 75,
    damageMultiplier: 1
  },
  {
    animation: "animation.copper_hammer.attack1",
    attackTime: 38,
    nextAttackWindow: 10,
    cancelIntoNextTick: 20,
    hitFrames: [15, 16],
    range: 3,
    coneDeg: 80,
    damageMultiplier: 1.15
  },
  {
    animation: "animation.copper_hammer.attack2",
    attackTime: 38,
    nextAttackWindow: 10,
    cancelIntoNextTick: 20,
    hitFrames: [17, 18],
    range: 3.5,
    coneDeg: 85,
    damageMultiplier: 2
  }
];
var COMBO_CFG4 = {
  anims: ANIMS4,
  animController: ANIM_CONTROLLER4,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS4,
  attackLockTicks: ATTACK_LOCK_TICKS4,
  comboResetTicks: COMBO_RESET_TICKS4
};
var STATE_KEY4 = "res_hammer_state";
var DEFAULT_STATE4 = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false,
  hitStreak: 0,
  lastHitTick: 0
};
var getState4 = (p) => {
  const r = p.getDynamicProperty(STATE_KEY4);
  return r ? JSON.parse(r) : { ...DEFAULT_STATE4 };
};
var setState4 = (p, s) => p.setDynamicProperty(STATE_KEY4, JSON.stringify(s));
function isHoldingWeapon4(player) {
  const eq = player.getComponent("minecraft:equippable");
  return !!eq && eq.getEquipment?.("Mainhand")?.typeId === WEAPON_ID4;
}
var calcDamage3 = (anim) => Math.floor(BASE_DAMAGE4 * anim.damageMultiplier);
var applyHit4 = safeHit((player, target, dmg) => {
  dealDamage(target, dmg, { cause: EntityDamageCause4.entityAttack, damagingEntity: player });
  const dir = player.getViewDirection();
  target.applyKnockback({ x: dir.x * 0.2, z: dir.z * 0.2 }, 0.02);
});
function isWet(entity) {
  try {
    if (entity.isInWater) return true;
    if (entity.isInRain) return true;
  } catch {
  }
  try {
    const { x, y, z } = entity.location;
    const block = entity.dimension.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
    if (block?.typeId === "minecraft:water" || block?.typeId === "minecraft:flowing_water") return true;
  } catch {
  }
  return false;
}
function tryShock(player, primaryTarget, state) {
  const tick = system7.currentTick;
  if (!state.lastHitTick || tick - state.lastHitTick > COMBO_RESET_TICKS4) state.hitStreak = 0;
  state.hitStreak = Math.min((state.hitStreak ?? 0) + 1, SHOCK_MAX_STREAK);
  state.lastHitTick = tick;
  if (state.hitStreak < SHOCK_THRESHOLD) return;
  if (isOnCooldown(player, "copper_hammer_shock")) return;
  withCooldown(player, "copper_hammer_shock", SHOCK_COOLDOWN_TICKS, () => {
  });
  const wet = isWet(player) || isWet(primaryTarget);
  const shockDamage = wet ? SHOCK_DAMAGE_WET : SHOCK_DAMAGE_BASE;
  const radius = wet ? SHOCK_RADIUS_WET : SHOCK_RADIUS_BASE;
  const nearby = primaryTarget.dimension.getEntities({ location: primaryTarget.location, maxDistance: radius }) || [];
  for (const e of nearby) {
    if (!e || e.id === player.id || e.id === primaryTarget.id) continue;
    if (!e.getComponent?.("minecraft:health")) continue;
    if (e.getComponent("minecraft:tameable")?.tamedToPlayerId === player.id) continue;
    try {
      dealDamage(e, shockDamage, { cause: EntityDamageCause4.magic, damagingEntity: player });
    } catch {
    }
  }
  try {
    world4.getDimension(player.dimension.id).playSound("random.orb", primaryTarget.location, {
      volume: 0.6,
      pitch: wet ? 1.4 : 1.2
    });
  } catch {
  }
}
function tickWeapon4(player) {
  if (!isHoldingWeapon4(player)) return;
  const state = getState4(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking) {
    setState4(player, state);
    return;
  }
  const anim = ANIMS4[state.comboIndex % ANIMS4.length];
  state.frame++;
  if (anim.hitFrames.includes(state.frame)) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    const dir = player.getViewDirection();
    player.applyKnockback({ x: dir.x, z: dir.z }, 0);
    if (targets.length > 0) {
      const dmg = calcDamage3(anim);
      for (const t of targets) applyHit4(player, t, dmg);
      tryShock(player, targets[0], state);
      try {
        world4.getDimension(player.dimension.id).playSound("random.anvil_use", player.location, { volume: 0.35, pitch: 1.6 });
        player.runCommand("execute as @s run camerashake add @s 0.3 0.3");
      } catch {
      }
    }
  }
  handleComboTransitionOrEnd(player, state, COMBO_CFG4, setState4);
}
onWeaponHit((ev) => {
  const { damagingEntity: attacker, hitEntity: victim } = ev;
  if (!attacker || attacker.typeId !== "minecraft:player" || !victim) return;
  if (!isHoldingWeapon4(attacker)) return;
  withCooldown(attacker, "copper_hammer_input", INPUT_COOLDOWN_TICKS4, () => {
    const s = getState4(attacker);
    resetAttackingFlagIfNeeded(attacker, s);
    if (s.isAttacking) {
      bufferNextAttack(attacker, s, setState4);
      return;
    }
    startAttack(attacker, s, COMBO_CFG4, setState4);
  });
});
system7.runInterval(() => world4.getPlayers().forEach(safeTick(tickWeapon4)), 1);

// scripts/armory/diamond/diamond_greatsword.ts
import { world as world5, system as system8, EntityDamageCause as EntityDamageCause5 } from "@minecraft/server";

// scripts/utils/armor.ts
import { EntityComponentTypes as EntityComponentTypes4 } from "@minecraft/server";
function getArmorValue2(target) {
  try {
    if (target.typeId === "minecraft:player") {
      const eq = target.getComponent(EntityComponentTypes4.Equippable);
      const totalArmor = eq?.totalArmor;
      if (typeof totalArmor === "number") {
        return totalArmor;
      }
    }
    const prop = target.getDynamicProperty?.("armor_value");
    if (typeof prop === "number") {
      return prop;
    }
    return 0;
  } catch (error) {
    return 0;
  }
}
function getArmorDamageReduction(target) {
  const armorValue = getArmorValue2(target);
  const reduction = Math.min(armorValue, 20) / 25;
  return reduction;
}

// scripts/armory/diamond/diamond_greatsword.ts
var WEAPON_ID5 = "resonance:diamond_greatsword";
var BASE_DAMAGE5 = 14;
var INPUT_COOLDOWN_TICKS5 = 2;
var COMBO_RESET_TICKS5 = 40;
var ATTACK_LOCK_TICKS5 = 2;
var ANIM_CONTROLLER5 = "res:greatsword_combo";
var FRACTURE_MAX_STACKS = 4;
var FRACTURE_ARMOR_REDUCTION = 0.1;
var FRACTURE_EXPIRE_TICKS = 100;
var SHATTER_BONUS_DAMAGE = 16;
var SHATTER_WEAKNESS_SECONDS = 3;
var SHATTER_WEAKNESS_TICKS = SHATTER_WEAKNESS_SECONDS * 20;
var SHATTER_COOLDOWN_TICKS = 60;
var KNOCKBACK_STRENGTH2 = 1.2;
var KNOCKBACK_VERTICAL2 = 0.3;
var ANIMS5 = [
  {
    animation: "animation.diamond_greatsword.attack",
    attackTime: 44,
    nextAttackWindow: 8,
    cancelIntoNextTick: 30,
    hitFrames: [25, 26],
    range: 4.5,
    coneDeg: 80,
    damageMultiplier: 1
  },
  {
    animation: "animation.diamond_greatsword.attack1",
    attackTime: 46,
    nextAttackWindow: 8,
    cancelIntoNextTick: 32,
    hitFrames: [25, 26],
    range: 5,
    coneDeg: 85,
    damageMultiplier: 1.2
  },
  {
    animation: "animation.diamond_greatsword.attack2",
    attackTime: 60,
    nextAttackWindow: 12,
    cancelIntoNextTick: 44,
    hitFrames: [31, 32],
    // finisher — paling lambat, paling sakit
    range: 5.3,
    coneDeg: 180,
    damageMultiplier: 1.5
  }
];
var CONFIG = {
  blendOutSeconds: 0.05,
  anims: ANIMS5,
  animController: ANIM_CONTROLLER5,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS5,
  attackLockTicks: ATTACK_LOCK_TICKS5,
  comboResetTicks: COMBO_RESET_TICKS5
};
var STATE_KEY5 = "res_greatsword_state";
var DEFAULT_STATE5 = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false,
  fractureAppliedThisSwing: false
};
var getState5 = (p) => {
  const r = p.getDynamicProperty(STATE_KEY5);
  return r ? JSON.parse(r) : { ...DEFAULT_STATE5 };
};
var setState5 = (p, s) => p.setDynamicProperty(STATE_KEY5, JSON.stringify(s));
function isHoldingWeapon5(player) {
  const eq = player.getComponent("minecraft:equippable");
  return !!eq && eq.getEquipment?.("Mainhand")?.typeId === WEAPON_ID5;
}
var fractureMap = /* @__PURE__ */ new Map();
function getTargetKey(target) {
  return target.id;
}
function getFractureStacks(target) {
  const key = getTargetKey(target);
  const data = fractureMap.get(key);
  if (!data) {
    return 0;
  }
  if (system8.currentTick - data.lastTick > FRACTURE_EXPIRE_TICKS) {
    fractureMap.delete(key);
    return 0;
  }
  return data.stacks;
}
function addFractureStack(target) {
  const key = getTargetKey(target);
  const current = getFractureStacks(target);
  const next = Math.min(current + 1, FRACTURE_MAX_STACKS);
  fractureMap.set(key, {
    stacks: next,
    lastTick: system8.currentTick
  });
  return next;
}
function clearFractureStacks(target) {
  fractureMap.delete(getTargetKey(target));
}
function calcDamage4(anim, target, stackCount) {
  const base = BASE_DAMAGE5 * anim.damageMultiplier;
  const armorReduction = getArmorDamageReduction(target);
  const fractureBypass = stackCount * FRACTURE_ARMOR_REDUCTION;
  const effectiveReduction = armorReduction * Math.max(0, 1 - fractureBypass);
  return Math.floor(base * (1 - effectiveReduction));
}
var applyHit5 = safeHit(function applyHit5(player, target, dmg) {
  dealDamage(target, dmg, { cause: EntityDamageCause5.entityAttack, damagingEntity: player });
  const dir = player.getViewDirection();
  target.applyKnockback({ x: dir.x * KNOCKBACK_STRENGTH2, z: dir.z * KNOCKBACK_STRENGTH2 }, KNOCKBACK_VERTICAL2);
});
function triggerShatter(player, target) {
  withCooldown(player, "greatsword_shatter", SHATTER_COOLDOWN_TICKS, () => {
    dealDamage(target, SHATTER_BONUS_DAMAGE, {
      cause: EntityDamageCause5.magic,
      damagingEntity: player
    });
    try {
      target.addEffect("weakness", SHATTER_WEAKNESS_TICKS, {
        amplifier: 1,
        // amplifier 1 = Weakness II (0-indexed)
        showParticles: true
        // efek partikel visible supaya target tahu mereka di-debuff
      });
    } catch {
    }
    clearFractureStacks(target);
    try {
      const dim = world5.getDimension(player.dimension.id);
      dim.playSound("random.break", target.location, { volume: 1, pitch: 0.7 });
      dim.playSound("random.break", target.location, { volume: 0.6, pitch: 1.8 });
      dim.playSound("random.levelup", player.location, { volume: 0.4, pitch: 1.4 });
    } catch {
    }
    try {
      player.runCommand("execute as @s run camerashake add @s 0.55 0.45");
    } catch {
    }
  });
}
function playFractureSound(target, stackCount) {
  try {
    world5.getDimension(target.dimension.id).playSound(
      "random.glass",
      target.location,
      { volume: 0.2 + stackCount * 0.05, pitch: 1 + stackCount * 0.15 }
      // stack 1 → pitch 1.15, stack 4 → pitch 1.60 — semakin tinggi = semakin "retak"
    );
  } catch {
  }
}
function tickGreatsword(player) {
  if (!isHoldingWeapon5(player)) return;
  const state = getState5(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking) {
    setState5(player, state);
    return;
  }
  const anim = CONFIG.anims[state.comboIndex % CONFIG.anims.length];
  const prevFrame = state.frame;
  state.frame++;
  if (prevFrame <= 0) {
    state.fractureAppliedThisSwing = false;
  }
  if (anim.hitFrames.includes(state.frame)) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    let hitSomething = false;
    for (const t of targets) {
      const stacksBefore = getFractureStacks(t);
      const newStacks = state.fractureAppliedThisSwing ? stacksBefore : addFractureStack(t);
      const dmg = calcDamage4(anim, t, stacksBefore);
      applyHit5(player, t, dmg);
      hitSomething = true;
      if (!state.fractureAppliedThisSwing) {
        if (stacksBefore >= FRACTURE_MAX_STACKS) {
          triggerShatter(player, t);
        } else {
          playFractureSound(t, newStacks);
        }
      }
    }
    state.fractureAppliedThisSwing = true;
    const dir = player.getViewDirection();
    player.applyKnockback({ x: dir.x, z: dir.z }, 0);
    if (targets.length > 0) {
      try {
        world5.getDimension(player.dimension.id).playSound(
          "random.anvil_land",
          player.location,
          { volume: 0.6, pitch: 0.85 }
          // lebih rendah dari halberd — ini weapon lebih besar
        );
        if (hitSomething) player.runCommand("execute as @s run camerashake add @s 0.35 0.35");
      } catch {
      }
    }
  }
  handleComboTransitionOrEnd(player, state, CONFIG, setState5);
}
onWeaponHit((ev) => {
  const attacker = ev.damagingEntity;
  if (!attacker || attacker.typeId !== "minecraft:player") return;
  if (!isHoldingWeapon5(attacker)) return;
  const state = getState5(attacker);
  resetAttackingFlagIfNeeded(attacker, state);
  withCooldown(attacker, "greatsword_input", INPUT_COOLDOWN_TICKS5, () => {
    const s = getState5(attacker);
    resetAttackingFlagIfNeeded(attacker, s);
    if (s.isAttacking) {
      bufferNextAttack(attacker, s, setState5);
      return;
    }
    s.fractureAppliedThisSwing = false;
    startAttack(attacker, s, CONFIG, setState5);
  });
});
system8.runInterval(() => {
  for (const p of world5.getPlayers()) safeTick(tickGreatsword)(p);
}, 1);

// scripts/armory/netherite/netherite_relic_blade.ts
import { world as world6, system as system9, EntityDamageCause as EntityDamageCause6 } from "@minecraft/server";
var WEAPON_ID6 = "resonance:netherite_relic_blade";
var BASE_DAMAGE6 = 10;
var INPUT_COOLDOWN_TICKS6 = 2;
var COMBO_RESET_TICKS6 = 40;
var ATTACK_LOCK_TICKS6 = 2;
var ANIM_CONTROLLER6 = "res:relic_blade_combo";
var SOUL_DRAIN_REGEN_TICKS = 40;
var SOUL_DRAIN_WEAKNESS_TICKS = 40;
var BURDEN_MAX_STACKS = 5;
var BURDEN_EXPIRE_TICKS = 100;
var BURDEN_SLOW_TICKS = 30;
var BURDEN_STUN_TICKS = 16;
var BURDEN_STUN_AMPLIFIER = 6;
var BURDEN_PROC_COOLDOWN_TICKS = 8;
var KNOCKBACK_STRENGTH3 = 0.45;
var KNOCKBACK_VERTICAL3 = 0.06;
var ANIMS6 = [
  {
    animation: "animation.netherite_relic_blade.attack",
    attackTime: 34,
    nextAttackWindow: 10,
    cancelIntoNextTick: 20,
    hitFrames: [14],
    range: 3.5,
    coneDeg: 90,
    damageMultiplier: 1
  },
  {
    animation: "animation.netherite_relic_blade.attack1",
    attackTime: 35,
    nextAttackWindow: 10,
    cancelIntoNextTick: 25,
    hitFrames: [17],
    range: 4.5,
    coneDeg: 70,
    damageMultiplier: 1.15
  },
  {
    animation: "animation.netherite_relic_blade.attack2",
    attackTime: 42,
    nextAttackWindow: 8,
    cancelIntoNextTick: 20,
    hitFrames: [17],
    // finisher — sedikit lebih lambat, multiplier tertinggi
    range: 4,
    coneDeg: 80,
    damageMultiplier: 1.4
  }
];
var COMBO_CFG5 = {
  anims: ANIMS6,
  animController: ANIM_CONTROLLER6,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS6,
  attackLockTicks: ATTACK_LOCK_TICKS6,
  comboResetTicks: COMBO_RESET_TICKS6
};
var STATE_KEY6 = "res_relic_blade_state";
var DEFAULT_STATE6 = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false,
  burdenAppliedThisSwing: false
};
var getState6 = (p) => {
  const raw = p.getDynamicProperty(STATE_KEY6);
  return raw ? JSON.parse(raw) : { ...DEFAULT_STATE6 };
};
var setState6 = (p, s) => {
  p.setDynamicProperty(STATE_KEY6, JSON.stringify(s));
};
function isHoldingWeapon6(player) {
  const eq = player.getComponent("minecraft:equippable");
  return !!eq && eq.getEquipment?.("Mainhand")?.typeId === WEAPON_ID6;
}
var calcDamage5 = (anim) => Math.floor(BASE_DAMAGE6 * anim.damageMultiplier);
var applyHit6 = safeHit(function applyHit6(player, target, dmg) {
  dealDamage(target, dmg, {
    cause: EntityDamageCause6.entityAttack,
    damagingEntity: player
  });
  const dir = player.getViewDirection();
  target.applyKnockback({ x: dir.x * KNOCKBACK_STRENGTH3, z: dir.z * KNOCKBACK_STRENGTH3 }, KNOCKBACK_VERTICAL3);
});
function applySoulDrain(player, target, burdenStacks) {
  const regenAmp = Math.min(Math.max(burdenStacks - 1, 0), 2);
  const weaknessAmp = Math.min(Math.max(burdenStacks - 1, 0), 2);
  try {
    player.addEffect("regeneration", SOUL_DRAIN_REGEN_TICKS, {
      amplifier: regenAmp,
      showParticles: false
    });
  } catch {
  }
  try {
    target.addEffect("weakness", SOUL_DRAIN_WEAKNESS_TICKS, {
      amplifier: weaknessAmp,
      showParticles: true
    });
  } catch {
  }
}
var burdenMap = /* @__PURE__ */ new Map();
function getTargetKey2(target) {
  return target.id;
}
function getBurdenStacks(target) {
  const key = getTargetKey2(target);
  const data = burdenMap.get(key);
  if (!data) return 0;
  if (system9.currentTick - data.lastTick > BURDEN_EXPIRE_TICKS) {
    burdenMap.delete(key);
    return 0;
  }
  return data.stacks;
}
function setBurdenStacks(target, stacks) {
  const key = getTargetKey2(target);
  if (stacks <= 0) {
    burdenMap.delete(key);
    return;
  }
  burdenMap.set(key, {
    stacks,
    lastTick: system9.currentTick
  });
}
function addBurdenStack(target) {
  const current = getBurdenStacks(target);
  const next = Math.min(current + 1, BURDEN_MAX_STACKS);
  setBurdenStacks(target, next);
  return next;
}
function clearBurdenStacks(target) {
  burdenMap.delete(getTargetKey2(target));
}
function applyBurdenEffect(target, stackCount) {
  if (stackCount >= BURDEN_MAX_STACKS) {
    try {
      target.addEffect("slowness", BURDEN_STUN_TICKS, {
        amplifier: BURDEN_STUN_AMPLIFIER,
        showParticles: true
      });
    } catch {
    }
    clearBurdenStacks(target);
    return;
  }
  const slowAmp = Math.max(0, Math.min(stackCount - 1, 3));
  try {
    target.addEffect("slowness", BURDEN_SLOW_TICKS, {
      amplifier: slowAmp,
      showParticles: true
    });
  } catch {
  }
}
function playBurdenSound(target, stackCount) {
  try {
    world6.getDimension(target.dimension.id).playSound("random.anvil_use", target.location, {
      volume: 0.18 + stackCount * 0.05,
      pitch: 1.15 - stackCount * 0.08
    });
  } catch {
  }
}
function triggerBurdenStun(player, target) {
  withCooldown(player, "relic_blade_burden_proc", BURDEN_PROC_COOLDOWN_TICKS, () => {
    try {
      world6.getDimension(target.dimension.id).playSound("random.anvil_land", target.location, {
        volume: 0.7,
        pitch: 0.65
      });
      world6.getDimension(player.dimension.id).playSound("random.levelup", player.location, {
        volume: 0.3,
        pitch: 1.2
      });
    } catch {
    }
    try {
      player.runCommand("execute as @s run camerashake add @s 0.4 0.35");
    } catch {
    }
  });
}
function tickWeapon5(player) {
  if (!isHoldingWeapon6(player)) return;
  const state = getState6(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking) {
    setState6(player, state);
    return;
  }
  const anim = ANIMS6[state.comboIndex % ANIMS6.length];
  const prevFrame = state.frame;
  state.frame++;
  if (prevFrame <= 0) {
    state.burdenAppliedThisSwing = false;
  }
  if (anim.hitFrames.includes(state.frame)) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    let hitSomething = false;
    for (const t of targets) {
      const dmg = calcDamage5(anim);
      applyHit6(player, t, dmg);
      hitSomething = true;
      const stacksAfter = state.burdenAppliedThisSwing ? getBurdenStacks(t) : addBurdenStack(t);
      if (!state.burdenAppliedThisSwing) {
        applyBurdenEffect(t, stacksAfter);
        applySoulDrain(player, t, stacksAfter);
        if (stacksAfter >= BURDEN_MAX_STACKS) {
          triggerBurdenStun(player, t);
        } else {
          playBurdenSound(t, stacksAfter);
        }
      }
    }
    state.burdenAppliedThisSwing = true;
    const dir = player.getViewDirection();
    player.applyKnockback({ x: dir.x, z: dir.z }, 0);
    if (hitSomething) {
      try {
        world6.getDimension(player.dimension.id).playSound("random.break", player.location, {
          volume: 0.35,
          pitch: 0.9
        });
        player.runCommand("execute as @s run camerashake add @s 0.22 0.2");
      } catch {
      }
    }
  }
  handleComboTransitionOrEnd(player, state, COMBO_CFG5, setState6);
}
onWeaponHit((ev) => {
  const { damagingEntity: attacker, hitEntity: victim } = ev;
  if (!attacker || attacker.typeId !== "minecraft:player" || !victim) return;
  if (!isHoldingWeapon6(attacker)) return;
  withCooldown(attacker, "netherite_relic_blade_input", INPUT_COOLDOWN_TICKS6, () => {
    const s = getState6(attacker);
    resetAttackingFlagIfNeeded(attacker, s);
    if (s.isAttacking) {
      bufferNextAttack(attacker, s, setState6);
      return;
    }
    s.burdenAppliedThisSwing = false;
    startAttack(attacker, s, COMBO_CFG5, setState6);
  });
});
system9.runInterval(() => {
  for (const p of world6.getPlayers()) safeTick(tickWeapon5)(p);
}, 1);

// scripts/armory/redstone/restone_pulse_gauntlet.ts
import { world as world7, system as system10, EntityDamageCause as EntityDamageCause7 } from "@minecraft/server";
var WEAPON_ID7 = "resonance:redstone_pulse_gauntlet";
var BASE_DAMAGE7 = 7;
var INPUT_COOLDOWN_TICKS7 = 2;
var COMBO_RESET_TICKS7 = 40;
var ATTACK_LOCK_TICKS7 = 2;
var ANIM_CONTROLLER7 = "res:redstone_pulse_gauntlet_combo";
var OVERCLOCK_MAX_TIER = 2;
var OVERCLOCK_CHAIN_BREAK_TICKS = 26;
var OVERCLOCK_SPEED_TICKS = 80;
var OVERCLOCK_SPEED_AMP_TIER_1 = 1;
var OVERCLOCK_SPEED_AMP_TIER_2 = 2;
var SHORT_CIRCUIT_MIN_TIER = 1;
var SHORT_CIRCUIT_SLOWNESS_TICKS = 60;
var SHORT_CIRCUIT_SLOWNESS_AMPLIFIER = 5;
var SHORT_CIRCUIT_WEAKNESS_TICKS = 60;
var SHORT_CIRCUIT_WEAKNESS_AMPLIFIER = 1;
var CAPACITOR_IDLE_TICKS = 40;
var CAPACITOR_BONUS_DAMAGE = 10;
var CAPACITOR_PROC_COOLDOWN_TICKS = 4;
var KNOCKBACK_STRENGTH4 = 0.35;
var KNOCKBACK_VERTICAL4 = 0.04;
var NORMAL_ANIMS = [
  {
    animation: "animation.redstone_pulse_gauntlet.attack",
    attackTime: 38,
    nextAttackWindow: 10,
    cancelIntoNextTick: 22,
    hitFrames: [21],
    range: 2.5,
    coneDeg: 76,
    damageMultiplier: 1
  },
  {
    animation: "animation.redstone_pulse_gauntlet.attack1",
    attackTime: 38,
    nextAttackWindow: 10,
    cancelIntoNextTick: 18,
    hitFrames: [17],
    range: 2.5,
    coneDeg: 80,
    damageMultiplier: 1.1
  },
  {
    animation: "animation.redstone_pulse_gauntlet.attack2",
    attackTime: 36,
    nextAttackWindow: 10,
    cancelIntoNextTick: 17,
    hitFrames: [16],
    range: 2.7,
    coneDeg: 84,
    damageMultiplier: 1.25
  }
];
var FAST_ANIMS = [
  {
    animation: "animation.redstone_pulse_gauntlet.fast_attack",
    attackTime: 38,
    nextAttackWindow: 10,
    cancelIntoNextTick: 15,
    hitFrames: [14],
    range: 2.5,
    coneDeg: 78,
    damageMultiplier: 1.05
  },
  {
    animation: "animation.redstone_pulse_gauntlet.fast_attack1",
    attackTime: 36,
    nextAttackWindow: 10,
    cancelIntoNextTick: 12,
    hitFrames: [11],
    range: 2.5,
    coneDeg: 82,
    damageMultiplier: 1.15
  },
  {
    animation: "animation.redstone_pulse_gauntlet.fast_attack2",
    attackTime: 36,
    nextAttackWindow: 10,
    cancelIntoNextTick: 12,
    hitFrames: [11],
    range: 2.7,
    coneDeg: 86,
    damageMultiplier: 1.3
  }
];
var MAX_ANIMS = [
  {
    animation: "animation.redstone_pulse_gauntlet.fast_attack3",
    attackTime: 36,
    nextAttackWindow: 10,
    cancelIntoNextTick: 12,
    hitFrames: [11],
    range: 3.3,
    coneDeg: 80,
    damageMultiplier: 1.1
  },
  {
    animation: "animation.redstone_pulse_gauntlet.fast_attack1",
    attackTime: 36,
    nextAttackWindow: 10,
    cancelIntoNextTick: 12,
    hitFrames: [11],
    range: 2.5,
    coneDeg: 82,
    damageMultiplier: 1.15
  },
  {
    animation: "animation.redstone_pulse_gauntlet.fast_attack2",
    attackTime: 36,
    nextAttackWindow: 10,
    cancelIntoNextTick: 12,
    hitFrames: [11],
    range: 2.7,
    coneDeg: 86,
    damageMultiplier: 1.3
  }
];
var BASE_COMBO_CFG = {
  anims: NORMAL_ANIMS,
  animController: ANIM_CONTROLLER7,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS7,
  attackLockTicks: ATTACK_LOCK_TICKS7,
  comboResetTicks: COMBO_RESET_TICKS7
};
var STATE_KEY7 = "res_redstone_pulse_gauntlet_state";
var DEFAULT_STATE7 = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false,
  overclockTier: 0,
  cycleTierLocked: 0,
  nextCycleTierLocked: 0,
  successfulHitsThisCycle: 0,
  cycleUpgradeApplied: false,
  overclockAppliedThisSwing: false,
  capacitorConsumedThisSwing: false,
  lastSuccessfulHitTick: 0
};
var getState7 = (p) => {
  const raw = p.getDynamicProperty(STATE_KEY7);
  return raw ? JSON.parse(raw) : { ...DEFAULT_STATE7 };
};
var setState7 = (p, s) => {
  p.setDynamicProperty(STATE_KEY7, JSON.stringify(s));
};
function isHoldingWeapon7(player) {
  const eq = player.getComponent("minecraft:equippable");
  return !!eq && eq.getEquipment?.("Mainhand")?.typeId === WEAPON_ID7;
}
function getAnimSetForTier(tier) {
  switch (tier) {
    case 2:
      return MAX_ANIMS;
    case 1:
      return FAST_ANIMS;
    default:
      return NORMAL_ANIMS;
  }
}
function getRuntimeConfig(state) {
  const currentSet = getAnimSetForTier(state.cycleTierLocked);
  if (state.isAttacking && state.comboIndex === 2 && state.nextCycleTierLocked !== state.cycleTierLocked) {
    const nextSet = getAnimSetForTier(state.nextCycleTierLocked);
    return {
      ...BASE_COMBO_CFG,
      anims: [
        nextSet[0],
        // dipakai jika combo loop ke attack pertama berikutnya
        nextSet[1],
        currentSet[2]
        // finisher current cycle tetap pakai tier saat ini
      ],
      animController: ANIM_CONTROLLER7
    };
  }
  return {
    ...BASE_COMBO_CFG,
    anims: currentSet,
    animController: ANIM_CONTROLLER7
  };
}
function getCurrentAnim(state) {
  const cfg = getRuntimeConfig(state);
  return cfg.anims[state.comboIndex % cfg.anims.length];
}
var calcDamage6 = (anim) => Math.floor(BASE_DAMAGE7 * anim.damageMultiplier);
var applyHit7 = safeHit(function applyHit7(player, target, dmg) {
  dealDamage(target, dmg, {
    cause: EntityDamageCause7.entityAttack,
    damagingEntity: player
  });
  const dir = player.getViewDirection();
  target.applyKnockback({ x: dir.x * KNOCKBACK_STRENGTH4, z: dir.z * KNOCKBACK_STRENGTH4 }, KNOCKBACK_VERTICAL4);
});
function resetOverclock(state) {
  state.overclockTier = 0;
  state.cycleTierLocked = 0;
  state.nextCycleTierLocked = 0;
  state.successfulHitsThisCycle = 0;
  state.cycleUpgradeApplied = false;
}
function triggerOverclockSpeed(player, tier) {
  if (tier <= 0) return;
  const amp = tier >= 2 ? OVERCLOCK_SPEED_AMP_TIER_2 : OVERCLOCK_SPEED_AMP_TIER_1;
  try {
    player.addEffect("haste", OVERCLOCK_SPEED_TICKS, {
      amplifier: amp,
      showParticles: true
    });
  } catch {
  }
  try {
    world7.getDimension(player.dimension.id).playSound("random.levelup", player.location, {
      volume: tier >= 2 ? 0.35 : 0.26,
      pitch: tier >= 2 ? 1.6 : 1.45
    });
  } catch {
  }
}
function triggerShortCircuit(player, state) {
  if (state.overclockTier < SHORT_CIRCUIT_MIN_TIER) {
    resetOverclock(state);
    return;
  }
  try {
    player.addEffect("slowness", SHORT_CIRCUIT_SLOWNESS_TICKS, {
      amplifier: SHORT_CIRCUIT_SLOWNESS_AMPLIFIER,
      showParticles: true
    });
  } catch {
  }
  try {
    player.addEffect("weakness", SHORT_CIRCUIT_WEAKNESS_TICKS, {
      amplifier: SHORT_CIRCUIT_WEAKNESS_AMPLIFIER,
      showParticles: true
    });
  } catch {
  }
  try {
    world7.getDimension(player.dimension.id).playSound("random.fizz", player.location, {
      volume: 0.55,
      pitch: 0.7
    });
    player.runCommand("execute as @s run camerashake add @s 0.45 0.25");
  } catch {
  }
  resetOverclock(state);
}
function isCapacitorReady(state) {
  if (state.lastSuccessfulHitTick <= 0) return false;
  return system10.currentTick - state.lastSuccessfulHitTick >= CAPACITOR_IDLE_TICKS;
}
function triggerCapacitorBurst(player, primaryTarget) {
  withCooldown(player, "redstone_pulse_gauntlet_capacitor", CAPACITOR_PROC_COOLDOWN_TICKS, () => {
    dealDamage(primaryTarget, CAPACITOR_BONUS_DAMAGE, {
      cause: EntityDamageCause7.entityAttack,
      damagingEntity: player
    });
    try {
      world7.getDimension(primaryTarget.dimension.id).playSound("random.orb", primaryTarget.location, {
        volume: 0.6,
        pitch: 1.8
      });
      player.runCommand("execute as @s run camerashake add @s 0.35 0.2");
    } catch {
    }
  });
}
function markSuccessfulSwing(state) {
  if (state.overclockAppliedThisSwing) return;
  state.overclockAppliedThisSwing = true;
  state.successfulHitsThisCycle = Math.min(3, state.successfulHitsThisCycle + 1);
}
function tryPromoteCycleTier(player, state) {
  if (state.comboIndex !== 2) return;
  if (state.cycleUpgradeApplied) return;
  if (state.successfulHitsThisCycle < 3) return;
  const nextTier = Math.min(state.overclockTier + 1, OVERCLOCK_MAX_TIER);
  state.cycleUpgradeApplied = true;
  state.overclockTier = nextTier;
  state.nextCycleTierLocked = nextTier;
  triggerOverclockSpeed(player, nextTier);
}
function resetCycleFlagsForNewSwing(state) {
  state.overclockAppliedThisSwing = false;
  state.capacitorConsumedThisSwing = false;
}
function beginNewCycle(state) {
  state.cycleTierLocked = state.nextCycleTierLocked;
  state.successfulHitsThisCycle = 0;
  state.cycleUpgradeApplied = false;
  resetCycleFlagsForNewSwing(state);
}
function tickWeapon6(player) {
  if (!isHoldingWeapon7(player)) return;
  const state = getState7(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking && state.overclockTier > 0) {
    const idleTicks = system10.currentTick - state.lastSuccessfulHitTick;
    if (state.lastSuccessfulHitTick > 0 && idleTicks > OVERCLOCK_CHAIN_BREAK_TICKS) {
      triggerShortCircuit(player, state);
      setState7(player, state);
      return;
    }
  }
  if (!state.isAttacking) {
    setState7(player, state);
    return;
  }
  const prevComboIndex = state.comboIndex;
  const wasAttackingBeforeStep = state.isAttacking;
  const anim = getCurrentAnim(state);
  state.frame++;
  if (state.frame === 1) {
    resetCycleFlagsForNewSwing(state);
  }
  if (anim.hitFrames.includes(state.frame)) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    const dir = player.getViewDirection();
    player.applyKnockback({ x: dir.x, z: dir.z }, 0);
    if (targets.length > 0) {
      const baseDmg = calcDamage6(anim);
      const capacitorReady = !state.capacitorConsumedThisSwing && isCapacitorReady(state);
      let hitSomething = false;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        applyHit7(player, t, baseDmg);
        hitSomething = true;
        if (i === 0 && capacitorReady) {
          triggerCapacitorBurst(player, t);
        }
      }
      if (hitSomething) {
        state.lastSuccessfulHitTick = system10.currentTick;
        markSuccessfulSwing(state);
        tryPromoteCycleTier(player, state);
        if (capacitorReady) {
          state.capacitorConsumedThisSwing = true;
          try {
            world7.getDimension(player.dimension.id).playSound("random.anvil_use", player.location, {
              volume: 0.35,
              pitch: 1.65
            });
          } catch {
          }
        }
        try {
          world7.getDimension(player.dimension.id).playSound("random.fuse", player.location, {
            volume: 0.25,
            pitch: 1.3 + state.overclockTier * 0.08
          });
          player.runCommand("execute as @s run camerashake add @s 0.2 0.15");
        } catch {
        }
      }
    }
  }
  handleComboTransitionOrEnd(player, state, getRuntimeConfig(state), setState7);
  if (wasAttackingBeforeStep && state.isAttacking && prevComboIndex === 2 && state.comboIndex === 0) {
    beginNewCycle(state);
  }
  setState7(player, state);
}
onWeaponHit((ev) => {
  const { damagingEntity: attacker, hitEntity: victim } = ev;
  if (!attacker || attacker.typeId !== "minecraft:player" || !victim) return;
  if (!isHoldingWeapon7(attacker)) return;
  withCooldown(attacker, "redstone_pulse_gauntlet_input", INPUT_COOLDOWN_TICKS7, () => {
    const s = getState7(attacker);
    resetAttackingFlagIfNeeded(attacker, s);
    if (s.isAttacking) {
      bufferNextAttack(attacker, s, setState7);
      return;
    }
    s.cycleTierLocked = s.overclockTier;
    s.nextCycleTierLocked = s.overclockTier;
    s.successfulHitsThisCycle = 0;
    s.cycleUpgradeApplied = false;
    resetCycleFlagsForNewSwing(s);
    startAttack(attacker, s, getRuntimeConfig(s), setState7);
  });
});
system10.runInterval(() => {
  for (const p of world7.getPlayers()) safeTick(tickWeapon6)(p);
}, 1);

// scripts/armory/quartz/lunar_crescent.ts
import { world as world8, system as system11, EntityDamageCause as EntityDamageCause8 } from "@minecraft/server";
var WEAPON_ID8 = "resonance:lunar_crescent";
var BASE_DAMAGE8 = 11;
var MOONLIGHT_DAMAGE_MULTIPLIER = 1.8;
var DARK_LIGHT_LEVEL = 7;
var NIGHT_START = 13e3;
var NIGHT_END = 23e3;
var INPUT_COOLDOWN_TICKS8 = 2;
var COMBO_RESET_TICKS8 = 40;
var ATTACK_LOCK_TICKS8 = 2;
var ANIM_CONTROLLER8 = "res:lunar_crescent";
var RETURN_DURATION_TICKS = 10;
var RETURN_DISTANCE = 3;
var RETURN_VERTICAL_OFFSET = 1;
var MAX_RETURN_DISTANCE = 8;
var SLOWNESS_TICKS = 20;
var SLOWNESS_AMPLIFIER = 1;
var ANIMS7 = [
  {
    animation: "animation.lunar_crescent.attack",
    /**
     * Shorter than Greatsword because Crescent is intended
     * to feel agile and controlled.
     */
    attackTime: 45,
    nextAttackWindow: 12,
    cancelIntoNextTick: 45,
    /**
     * Two adjacent hit frames create a small hit window.
     *
     * Guarded by hitAppliedThisSwing so one target cannot
     * receive damage twice from the same swing.
     */
    hitFrames: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
    range: 5.5,
    coneDeg: 85,
    damageMultiplier: 1
  }
];
var CONFIG2 = {
  anims: ANIMS7,
  animController: ANIM_CONTROLLER8,
  inputCooldownTicks: INPUT_COOLDOWN_TICKS8,
  attackLockTicks: ATTACK_LOCK_TICKS8,
  comboResetTicks: COMBO_RESET_TICKS8
};
var STATE_KEY8 = "res_lunar_crescent_state";
var DEFAULT_STATE8 = {
  comboIndex: 0,
  isAttacking: false,
  frame: 0,
  bufferedNext: false,
  lockUntilTick: 0,
  lastAttackTick: 0,
  attackingFlagUntil: 0,
  inputLockUntilTick: 0,
  inputLocked: false,
  hitAppliedThisSwing: false
};
var getState8 = (player) => {
  const raw = player.getDynamicProperty(STATE_KEY8);
  return raw ? JSON.parse(raw) : { ...DEFAULT_STATE8 };
};
var setState8 = (player, state) => {
  player.setDynamicProperty(STATE_KEY8, JSON.stringify(state));
};
function isHoldingWeapon8(player) {
  const equippable = player.getComponent("minecraft:equippable");
  return !!equippable && equippable.getEquipment?.("Mainhand")?.typeId === WEAPON_ID8;
}
function isNighttime() {
  try {
    const time = world8.getTimeOfDay();
    return time >= NIGHT_START && time < NIGHT_END;
  } catch {
    return false;
  }
}
function getPlayerLightLevel(player) {
  try {
    const dimension = world8.getDimension(player.dimension.id);
    const location = player.location;
    const feetBlock = dimension.getBlock({
      x: Math.floor(location.x),
      y: Math.floor(location.y),
      z: Math.floor(location.z)
    });
    const headBlock = dimension.getBlock({
      x: Math.floor(location.x),
      y: Math.floor(location.y + 1),
      z: Math.floor(location.z)
    });
    const feetLight = feetBlock?.getLightLevel?.() ?? 15;
    const headLight = headBlock?.getLightLevel?.() ?? 15;
    return Math.min(Number(feetLight), Number(headLight));
  } catch {
    return 15;
  }
}
function hasMoonlight(player) {
  if (isNighttime()) {
    return true;
  }
  const lightLevel = getPlayerLightLevel(player);
  return lightLevel <= DARK_LIGHT_LEVEL;
}
function calcDamage7(player, anim) {
  const baseDamage = BASE_DAMAGE8 * anim.damageMultiplier;
  const empoweredByMoonlight = hasMoonlight(player);
  if (!empoweredByMoonlight) {
    return Math.floor(baseDamage);
  }
  return Math.floor(baseDamage * MOONLIGHT_DAMAGE_MULTIPLIER);
}
function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function getForwardPosition(player) {
  const origin = player.location;
  const direction = player.getViewDirection();
  return {
    x: origin.x + direction.x * RETURN_DISTANCE,
    y: origin.y + RETURN_VERTICAL_OFFSET + direction.y * RETURN_DISTANCE,
    z: origin.z + direction.z * RETURN_DISTANCE
  };
}
var returningTargets = /* @__PURE__ */ new Map();
function startReturningCrescent(player, target) {
  const targetId = target.id;
  returningTargets.set(targetId, {
    playerId: player.id,
    targetId,
    expiresAt: system11.currentTick + RETURN_DURATION_TICKS
  });
  try {
    target.addEffect("slowness", SLOWNESS_TICKS, {
      amplifier: SLOWNESS_AMPLIFIER,
      showParticles: true
    });
  } catch {
  }
  try {
    const dimension = world8.getDimension(player.dimension.id);
    dimension.playSound("random.orb", target.location, {
      volume: 0.65,
      pitch: 0.65
    });
  } catch {
  }
}
function tickReturningTargets() {
  for (const [targetId, data] of returningTargets) {
    if (system11.currentTick >= data.expiresAt) {
      returningTargets.delete(targetId);
      continue;
    }
    let player;
    let target;
    try {
      player = world8.getPlayers().find((p) => p.id === data.playerId);
      if (!player) {
        returningTargets.delete(targetId);
        continue;
      }
      const entities = player.dimension.getEntities({
        location: player.location,
        maxDistance: MAX_RETURN_DISTANCE
      });
      target = entities.find((entity) => entity.id === targetId);
      if (!target) {
        returningTargets.delete(targetId);
        continue;
      }
      if (target.dimension.id !== player.dimension.id) {
        returningTargets.delete(targetId);
        continue;
      }
      const destination = getForwardPosition(player);
      if (distance(player.location, target.location) > MAX_RETURN_DISTANCE) {
        returningTargets.delete(targetId);
        continue;
      }
      target.teleport(destination, {
        dimension: player.dimension,
        rotation: target.getRotation()
      });
    } catch {
      returningTargets.delete(targetId);
    }
  }
}
var applyHit8 = safeHit(function applyHit8(player, target, anim) {
  const damage = calcDamage7(player, anim);
  dealDamage(target, damage, {
    cause: EntityDamageCause8.entityAttack,
    damagingEntity: player
  });
  startReturningCrescent(player, target);
});
function playMoonlightHitSound(player, empowered) {
  try {
    const dimension = world8.getDimension(player.dimension.id);
    if (empowered) {
      dimension.playSound("random.orb", player.location, {
        volume: 0.8,
        pitch: 0.55
      });
      dimension.playSound("random.levelup", player.location, {
        volume: 0.25,
        pitch: 1.6
      });
    } else {
      dimension.playSound("random.attack", player.location, {
        volume: 0.6,
        pitch: 1.1
      });
    }
  } catch {
  }
}
function tickWeapon7(player) {
  if (!isHoldingWeapon8(player)) {
    return;
  }
  const state = getState8(player);
  resetAttackingFlagIfNeeded(player, state);
  maintainOrReleaseInputLock(player, state);
  if (!state.isAttacking) {
    setState8(player, state);
    return;
  }
  const anim = ANIMS7[0];
  const previousFrame = state.frame;
  state.frame++;
  if (previousFrame <= 0) {
    state.hitAppliedThisSwing = false;
  }
  if (anim.hitFrames.includes(state.frame) && !state.hitAppliedThisSwing) {
    const targets = getTargetsInCone(player, anim.range, anim.coneDeg, 10);
    let hitSomething = false;
    const empowered = hasMoonlight(player);
    for (const target of targets) {
      applyHit8(player, target, anim);
      hitSomething = true;
    }
    if (state.frame === anim.hitFrames[0]) {
      const direction = player.getViewDirection();
      player.applyKnockback({ x: direction.x * 0.35, z: direction.z * 0.35 }, 0);
    }
    if (hitSomething) {
      state.hitAppliedThisSwing = true;
      playMoonlightHitSound(player, empowered);
      try {
        player.runCommand("execute as @s run camerashake add @s 0.2 0.2");
      } catch {
      }
    } else if (state.frame === anim.hitFrames[anim.hitFrames.length - 1]) {
      playMoonlightHitSound(player, false);
    }
  }
  handleComboTransitionOrEnd(player, state, CONFIG2, setState8);
}
onWeaponHit((ev) => {
  const { damagingEntity: attacker, hitEntity: victim } = ev;
  if (!attacker || attacker.typeId !== "minecraft:player" || !victim) {
    return;
  }
  if (!isHoldingWeapon8(attacker)) {
    return;
  }
  withCooldown(attacker, "lunar_crescent_input", INPUT_COOLDOWN_TICKS8, () => {
    const state = getState8(attacker);
    resetAttackingFlagIfNeeded(attacker, state);
    if (state.isAttacking) {
      bufferNextAttack(attacker, state, setState8);
      return;
    }
    state.hitAppliedThisSwing = false;
    startAttack(attacker, state, CONFIG2, setState8);
  });
});
system11.runInterval(() => {
  for (const player of world8.getPlayers()) {
    safeTick(tickWeapon7)(player);
  }
  tickReturningTargets();
}, 1);

// scripts/systems/session.ts
var ALL_STATE_KEYS = [STATE_KEY, STATE_KEY2, STATE_KEY3, STATE_KEY4, STATE_KEY5, STATE_KEY6, STATE_KEY7, STATE_KEY8];
function resetPlayerCombatState(player) {
  for (const key of ALL_STATE_KEYS) {
    try {
      player.setDynamicProperty(key, void 0);
    } catch {
    }
  }
  try {
    player.setDynamicProperty(ATTACKING_FLAG, 0);
  } catch {
  }
  clearCooldowns(player);
  activeInputLocks.delete(player.id);
  enableMovement(player);
}
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) resetPlayerCombatState(player);
});
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  activeInputLocks.delete(playerId);
  const prefix = `${playerId}:`;
  for (const k of [...cooldowns.keys()]) if (k.startsWith(prefix)) cooldowns.delete(k);
});
system.runInterval(releaseExpiredInputLocks, 1);

