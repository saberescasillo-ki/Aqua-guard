"""Motion+ logic rewrite: engine data instead of hand-tracked world position."""
import json, re, sys, copy
ORIG, OUT_DIR = sys.argv[1], sys.argv[2]
src = json.load(open(ORIG))
anim = copy.deepcopy(src['animations']['animation.mbp_ap.player'])
B = anim['bones']
MH = "'slot.weapon.mainhand'"

def cut(e, start, end, new):
    i, j = e.index(start), e.index(end)
    assert e.count(start) == 1 and e.count(end) == 1 and i < j, (start, end)
    return e[:i] + new + e[j:]

e = B['body']['rotation'][0]
# 1) world-position tracking -> gone (motion_y and direction now come from the world-only expression)
e = cut(e, '!q.is_in_ui ? ({ v.last_pos_tick', 'v.vertical_distance_moved =', '')
# 2) direction relative to the body: computed in the world-only expression; the doll walks forward
e = cut(e, '(math.abs(v.motion_x) >', 'v.is_jumping = v.is_jumping ?? 0;',
    'v.is_moving = q.ground_speed > 0.5 || q.modified_move_speed > 0.1;'
    'v.fbdir_dot = v.is_moving ? (v.has_dir ? v.dir_fb : 1) : 0;'
    'v.fbdir_dot_nonzero = v.fbdir_dot == 0 ? (v.fbdir_dot_nonzero ?? 0) : v.fbdir_dot;'
    'v.lrdir_dot = v.is_moving ? (v.has_dir ? v.dir_lr : 0) : 0;'
    'v.lrdir_dot_nonzero = v.lrdir_dot == 0 ? (v.lrdir_dot_nonzero ?? 0) : v.lrdir_dot;')
# 3) jumping: computed in the world-only expression
e = cut(e, 'q.is_local_player ? { (q.is_on_ground', 'v.leg_sign_jump_impulse = v.leg_sign_jump_impulse ?? 0;', '')
# 4) underwater / falling / moving: world-only expression (falling, underwater) or above (moving)
e = cut(e, 'v.is_underwater =', '(v.in_blockbench ?? 0)', 'v.vdir_dot = (v.motion_y < 10 ? 1 : -1);')
# 5) history buffers only use q.life_time: run them everywhere
assert e.count('!q.is_in_ui ? ({ v.last_motion_y_tick') == 1
e = e.replace('!q.is_in_ui ? ({ v.last_motion_y_tick', '1 ? ({ v.last_motion_y_tick')

# what the EAF script used to send, from engine data that also exists in the inventory doll
flags = ';'.join([
    't.using = (variable.item_use_normalized ?? 0) > 0',
    't.item = q.get_equipped_item_name',
    f"v.holding_sword = q.equipped_item_any_tag({MH}, 'minecraft:is_sword')",
    f"v.is_eating = t.using && (q.equipped_item_any_tag({MH}, 'minecraft:is_food') || t.item == 'cod' || t.item == 'salmon' || t.item == 'pufferfish')",
    "v.is_drinking = t.using && (t.item == 'potion' || t.item == 'honey_bottle' || t.item == 'ominous_bottle')",
    "v.is_drawing_bow = t.using && t.item == 'bow'",
    "v.is_spying = t.using && t.item == 'spyglass'",
    "v.is_fishing = t.item == 'fishing_rod'",
    'v.is_hurt = q.hurt_time > 7',
    "v.is_riding_boat = q.is_riding && q.is_riding_any_entity_of_type('minecraft:boat', 'minecraft:chest_boat')",
    "v.is_riding_minecart = q.is_riding && q.is_riding_any_entity_of_type('minecraft:minecart')",
    'v.is_riding_unknown = q.is_riding && v.is_riding_boat == 0 && v.is_riding_minecart == 0',
]) + ';'
e = flags + e
B['body']['rotation'][0] = e

# world-only expression: its first query does not exist in the inventory doll, so there it stops
# before changing anything and the doll keeps neutral values instead of a frozen jump or flight
world_only = ';'.join([
    # only the real player has variable.swim_amount; the inventory doll does not (its queries return 0 there)
    't.real = (variable.swim_amount ?? -1) >= 0',
    't.real ? {'
    't.dx = q.position_delta(0); t.dz = q.position_delta(2); t.dy = q.position_delta(1);'
    'v.motion_y = math.clamp(t.dy * 10, -20, 20);'
    't.len = math.sqrt(t.dx * t.dx + t.dz * t.dz);'
    'v.has_dir = 1;'
    't.len > 0.01 ? { v.dir_fb = (math.cos(q.body_y_rotation + 90) * t.dx + math.sin(q.body_y_rotation + 90) * t.dz) / t.len; '
    'v.dir_lr = (math.cos(q.body_y_rotation + 180) * t.dx + math.sin(q.body_y_rotation + 180) * t.dz) / t.len; };'
    "v.is_underwater = q.relative_block_has_all_tags(0, -0.5, 0, 'water') && !q.is_on_ground;"
    'v.is_falling = v.motion_y < -4.5 ? 1 : 0;'
    # sampled once per game tick: position_delta is per tick, frames in between repeat it
    't.tick = math.round(q.life_time * 20 - 0.5);'
    '(t.tick != (v.motion_tick ?? 0)) ? {'
    'v.motion_tick = t.tick;'
    't.acc = t.dy - (v.last_dy ?? 0); v.last_dy = t.dy;'
    't.airborne = !q.is_on_ground && !q.is_in_water && !q.is_gliding && !q.is_swimming && !q.is_riding;'
    # ladders/vines: steady ~0.12 blocks/tick up or ~0.15 down with no horizontal motion
    'v.climb_ticks = (t.airborne && t.len < 0.05 && (math.abs(t.dy - 0.1176) < 0.03 || math.abs(t.dy + 0.15) < 0.03)) ? (v.climb_ticks ?? 0) + 1 : 0;'
    # creative flight: airborne with no gravity (a jump loses ~0.08 blocks/tick every tick)
    'v.fly_ticks = (t.airborne && math.abs(t.acc) < 0.03 && t.dy > -0.5 && v.climb_ticks < 2) ? (v.fly_ticks ?? 0) + 1 : 0;'
    '};'
    'v.is_climbing = v.climb_ticks >= 4 ? 1 : 0;'
    'v.is_flying = v.fly_ticks > 6 ? 1 : 0;'
    't.last_is_jumping = v.is_jumping ?? 0;'
    'v.is_jumping = !q.is_on_ground && !q.is_in_water && v.is_climbing == 0 && v.is_flying == 0 && v.is_falling == 0;'
    '(t.last_is_jumping != v.is_jumping && v.is_jumping) ? { v.leg_sign_jump_impulse = ((v.leg_sign_jump_impulse ?? 0) == -1) ? 1 : -1; };'
    '}',
    'return 0',
]) + ';'
B['body']['position'] = [world_only, 0, 0]

def swap(x, old, new):
    assert x.count(old) == 1, old
    return x.replace(old, new)
B['root']['rotation'][0] = swap(B['root']['rotation'][0], ') * 6) + math.clamp(22.5 * -v.motion_y_smoothed, -45, 45);', ') * 6) + q.target_x_rotation;')
B['root']['position'][1] = swap(B['root']['position'][1], 'v.swimming = 8 + (', 'v.swimming = math.sin(q.target_x_rotation) * 17 + 5 + (')
B['root']['position'][2] = swap(B['root']['position'][2], 'v.swimming = 16;', 'v.swimming = math.cos(q.target_x_rotation) * 17;')

# items: name checks that also work in the doll
ITEM = {"q.is_item_name_any('slot.weapon.mainhand', 'minecraft:crossbow')": "(q.get_equipped_item_name == 'crossbow')",
        "q.is_item_name_any('slot.weapon.mainhand', 'minecraft:trident')": "(q.get_equipped_item_name == 'trident')",
        "q.is_item_name_any('slot.weapon.mainhand', 'minecraft:filled_map')": "(q.get_equipped_item_name == 'filled_map')",
        "q.is_item_name_any('slot.weapon.offhand', 'minecraft:filled_map')": "(q.get_equipped_item_name('off_hand') == 'filled_map')",
        "q.is_item_name_any('slot.weapon.offhand', 'minecraft:shield')": "(q.get_equipped_item_name('off_hand') == 'shield')"}
def items(x):
    if isinstance(x, str):
        for a, b in ITEM.items(): x = x.replace(a, b)
        return x
    if isinstance(x, list): return [items(v) for v in x]
    if isinstance(x, dict): return {k: items(v) for k, v in x.items()}
    return x
anim['bones'] = B = items(B)

# sword swing while sprinting: the right arm switched on/off with "attack_time > 0" while the rest of the
# body blended smoothly; blend it like the rest and keep the last swing pose while it fades out
for i in range(3):
    x = B['rightArm']['rotation'][i]
    old = 'v.sword_attack, v.sword_attack_time > 0 )'
    assert x.count(old) == 1, i
    k = x.rindex('return math.lerp(')
    x = x[:k] + f'(v.sword_attack_time > 0) ? {{ v.sword_attack_hold{i} = v.sword_attack; }};' + x[k:]
    B['rightArm']['rotation'][i] = x.replace(old, f'v.sword_attack_hold{i}, v.sword_attack_smoothed )')

# guard every variable read with "?? 0" (the doll starts with no variables at all)
VAR = re.compile(r'(?<![\w.])((?:v|variable)\.[A-Za-z_]\w*)')
def guard(s):
    out, i = [], 0
    for m in VAR.finditer(s):
        rest = s[m.end():]
        if re.match(r'\s*=(?!=)', rest) or re.match(r'\s*\?\?', rest): continue
        out += [s[i:m.start()], f'({m.group(1)} ?? 0)']; i = m.end()
    return ''.join(out + [s[i:]])
def walk(x):
    if isinstance(x, str): return guard(x)
    if isinstance(x, list): return [walk(v) for v in x]
    if isinstance(x, dict): return {k: walk(v) for k, v in x.items()}
    return x
anim['bones'] = walk(anim['bones'])
anim['blend_weight'] = guard(anim['blend_weight'])

left = sorted(set(re.findall(r'q\.(?:is_item_name_any|position|position_delta|is_local_player|relative_block_has_all_tags)\b', json.dumps({k: v for k, v in anim['bones'].items()}).replace(json.dumps(B['body']['position'][0])[1:-1], ''))))
print('consultas de entidad fuera de la expresión solo-mundo:', left or 'ninguna')
out = {'format_version': src['format_version'], 'animations': {'animation.humanoid.fishing_rod': anim}}
open(f'{OUT_DIR}/animations/mp/ar/argee.player.animation.rp.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False) + '\n')

c = f'{OUT_DIR}/animation_controllers/player.animation_controllers.json'
cd = json.load(open(c)); st = cd['animation_controllers']['controller.animation.player.root']['states']
key = lambda a: a if isinstance(a, str) else list(a)[0]
st['third_person']['animations'] = [a for a in st['third_person']['animations'] if key(a) not in ('fishing_rod', 'first_person_attack_rotation_item', 'first_person_crossbow_hold')]
spear = [a for a in st['third_person']['animations'] if key(a) == 'third_person_melee_spear_controller'][0]
st['third_person']['animations'].remove(spear)
st['third_person']['animations'] += [{'fishing_rod': 'q.is_alive && !q.is_gliding'}, spear]
st['paperdoll']['animations'] = [a for a in st['paperdoll']['animations'] if a not in ('fishing_rod', 'first_person_attack_rotation_item', 'first_person_crossbow_hold')] + ['fishing_rod']
open(c, 'w').write(json.dumps(cd, indent=2) + '\n')
print('third_person (final):', [key(a) for a in st['third_person']['animations'][-3:]], '| paperdoll:', st['paperdoll']['animations'])
