"""
Procedural tree designer for the BREATHE add-ons.

Each species function draws one tree into a voxel grid from a seed. The
result is saved as a Bedrock .mcstructure file (little-endian NBT), so the
game places the exact shape we designed instead of using its built-in
canopy shapes.

Local coordinates: y = 0 is the first block above the ground, y = -1 is the
ground block itself (roots and soil patches), x/z = 0 is the trunk.
"""

import math
import random
import struct

BLOCK_VERSION = 18168865  # palette compatibility version (1.21.60.33)

# Leaves further than this from a log (walking through leaves) are made
# persistent so they never decay.
LEAF_DECAY_RANGE = 4

LOG, LEAF, DECOR, SOIL = 3, 2, 1, 0      # placement priority


# ---------------------------------------------------------------------------
# Minimal little-endian NBT writer
# ---------------------------------------------------------------------------

class Byte(int):
    pass


class Int(int):
    pass


class NbtList(list):
    def __init__(self, tag_type, items=()):
        super().__init__(items)
        self.tag_type = tag_type


TAG_BYTE, TAG_INT, TAG_STRING, TAG_LIST, TAG_COMPOUND = 1, 3, 8, 9, 10


def _tag_type(value):
    if isinstance(value, Byte):
        return TAG_BYTE
    if isinstance(value, bool):
        return TAG_BYTE
    if isinstance(value, int):
        return TAG_INT
    if isinstance(value, str):
        return TAG_STRING
    if isinstance(value, NbtList):
        return TAG_LIST
    if isinstance(value, dict):
        return TAG_COMPOUND
    raise TypeError(type(value))


def _payload(out, value):
    kind = _tag_type(value)
    if kind == TAG_BYTE:
        out += struct.pack("<b", int(value))
    elif kind == TAG_INT:
        out += struct.pack("<i", int(value))
    elif kind == TAG_STRING:
        raw = value.encode("utf-8")
        out += struct.pack("<H", len(raw)) + raw
    elif kind == TAG_LIST:
        out += struct.pack("<bi", value.tag_type, len(value))
        if value.tag_type == TAG_INT:
            out += struct.pack(f"<{len(value)}i", *value)
        else:
            for item in value:
                _payload(out, item)
    else:
        for name, item in value.items():
            raw = name.encode("utf-8")
            out += struct.pack("<bH", _tag_type(item), len(raw)) + raw
            _payload(out, item)
        out += b"\x00"


def nbt_bytes(root):
    out = bytearray(b"\x0a\x00\x00")   # unnamed root compound
    _payload(out, root)
    return bytes(out)


# ---------------------------------------------------------------------------
# Voxel grid
# ---------------------------------------------------------------------------

def _state_value(v):
    if isinstance(v, bool):
        return Byte(1 if v else 0)
    if isinstance(v, int):
        return Int(v)
    return v


class Tree:
    def __init__(self, log, leaves, wood=None, trunk_center=(0.0, 0.0)):
        self.log = log
        self.leaves = leaves
        self.wood = wood or log.replace("_log", "_wood")
        self.cells = {}          # (x, y, z) -> (priority, name, states)
        self.trunk_center = trunk_center

    # -- primitives ----------------------------------------------------------
    def put(self, p, name, states=None, priority=LOG, replace=False):
        p = (int(round(p[0])), int(round(p[1])), int(round(p[2])))
        if p[1] < -1:
            return
        cur = self.cells.get(p)
        if cur and cur[0] >= priority and not replace:
            return
        self.cells[p] = (priority, name, states or {})

    def log_at(self, p, axis="y"):
        self.put(p, self.log, {"pillar_axis": axis}, LOG)

    def wood_at(self, p):
        self.put(p, self.wood, {"pillar_axis": "y"}, LOG)

    def leaf_at(self, p, leaves=None):
        self.put(p, leaves or self.leaves, {}, LEAF)

    def is_free(self, p):
        return p not in self.cells

    # -- shapes ----------------------------------------------------------------
    def trunk(self, width, height, rng, lean=0.0, start_y=0, wobble=0.35):
        """Vertical trunk; returns its centre line [(x, y, z), ...]."""
        cx, cz = self.trunk_center
        heading = rng.uniform(0, math.tau)
        path = []
        for y in range(start_y, height):
            t = (y - start_y) / max(1, height - start_y)
            ox = math.cos(heading) * lean * t * t * height
            oz = math.sin(heading) * lean * t * t * height
            ox += math.sin(y * 0.45 + heading) * wobble
            oz += math.cos(y * 0.37 + heading) * wobble
            bx, bz = round(cx + ox - (width - 1) / 2), round(cz + oz - (width - 1) / 2)
            for dx in range(width):
                for dz in range(width):
                    if width >= 3 and dx in (0, width - 1) and dz in (0, width - 1):
                        continue    # round off 3x3 trunks
                    self.log_at((bx + dx, y, bz + dz))
            path.append((bx + (width - 1) / 2, y, bz + (width - 1) / 2))
        return path

    def limb(self, start, yaw, pitch, length, thickness=0, curve=0.0,
             droop=0.0):
        """Branch from start; returns the end point."""
        x, y, z = start
        steps = max(1, int(length * 2))
        for i in range(steps + 1):
            t = i / steps
            p = pitch + curve * t - droop * t * t
            dx = math.cos(yaw) * math.cos(p)
            dz = math.sin(yaw) * math.cos(p)
            dy = math.sin(p)
            if i:
                x, y, z = x + dx * 0.5, y + dy * 0.5, z + dz * 0.5
            axis = "y" if abs(dy) >= max(abs(dx), abs(dz)) else (
                "x" if abs(dx) >= abs(dz) else "z")
            self.log_at((x, y, z), axis)
            if thickness and t < 0.6:
                for ox, oz in ((1, 0), (0, 1)):
                    self.log_at((x + ox, y, z + oz), axis)
        return (x, y, z)

    def blob(self, center, rx, ry, rz, rng, leaves=None, ragged=0.28,
             flat_bottom=False):
        cx, cy, cz = center
        for x in range(int(cx - rx - 1), int(cx + rx + 2)):
            for y in range(int(cy - ry - 1), int(cy + ry + 2)):
                if flat_bottom and y < cy - ry * 0.35:
                    continue
                for z in range(int(cz - rz - 1), int(cz + rz + 2)):
                    d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + \
                        ((z - cz) / rz) ** 2
                    if d <= 1.0 - rng.random() * ragged:
                        self.leaf_at((x, y, z), leaves)

    def cluster(self, center, radius, rng, leaves=None, squash=0.7, parts=4):
        """Several overlapping blobs: fluffy, never a clean geometric shape."""
        self.blob(center, radius, radius * squash, radius, rng, leaves)
        for _ in range(parts):
            a = rng.uniform(0, math.tau)
            off = radius * rng.uniform(0.35, 0.75)
            c = (center[0] + math.cos(a) * off,
                 center[1] + rng.uniform(-0.6, 0.8) * radius * squash * 0.6,
                 center[2] + math.sin(a) * off)
            r = radius * rng.uniform(0.5, 0.75)
            self.blob(c, r, r * squash, r, rng, leaves)

    def disc(self, center, radius, rng, thickness=1, leaves=None, ragged=0.35):
        cx, cy, cz = center
        for layer in range(thickness):
            r = radius - layer * 1.2
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                for z in range(int(cz - r - 1), int(cz + r + 2)):
                    d = math.hypot(x - cx, z - cz) / max(r, 0.5)
                    if d <= 1.0 - rng.random() * ragged:
                        self.leaf_at((x, cy + layer, z), leaves)

    def roots(self, width, rng, count, reach, soil=None):
        """Buttress roots flaring out over the ground."""
        cx, cz = self.trunk_center
        half = width / 2
        base = rng.uniform(0, math.tau)
        for i in range(count):
            a = base + i * math.tau / count + rng.uniform(-0.3, 0.3)
            length = rng.uniform(reach * 0.6, reach)
            steps = int(length * 2) + 1
            for s in range(steps):
                d = half + s * 0.5
                h = max(0.0, (1 - s / steps) * min(2.5, width + 0.5))
                x, z = cx + math.cos(a) * d, cz + math.sin(a) * d
                for y in range(0, int(h) + 1):
                    self.wood_at((x, y, z))
                self.wood_at((x, -1, z))
        if soil:
            r = half + reach * 0.8
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                for z in range(int(cz - r - 1), int(cz + r + 2)):
                    if math.hypot(x - cx, z - cz) <= r - rng.random():
                        self.put((x, -1, z), soil, {}, SOIL)

    # -- decorations -----------------------------------------------------------
    # Bedrock vine_direction_bits: 1 = south, 2 = west, 4 = north, 8 = east;
    # the bit names the side the supporting block is on.
    VINE_SIDES = ((0, 1, 1), (-1, 0, 2), (0, -1, 4), (1, 0, 8))

    def vines(self, rng, chance, max_len, on_trunk=False):
        targets = [p for p, c in self.cells.items()
                   if c[0] == LEAF or (on_trunk and c[0] == LOG)]
        for (x, y, z) in targets:
            for dx, dz, bit in self.VINE_SIDES:
                v = (x - dx, y, z - dz)     # cell next to the block
                if not self.is_free(v) or rng.random() > chance:
                    continue
                for k in range(rng.randint(1, max_len)):
                    q = (v[0], v[1] - k, v[2])
                    if q[1] < 1 or not self.is_free(q):
                        break
                    self.put(q, "minecraft:vine",
                             {"vine_direction_bits": bit}, DECOR)

    def hanging(self, rng, chance, max_len, name, tip_state=None,
                leaves_only=True):
        """Blocks hanging straight down from the underside of the canopy."""
        for (x, y, z), c in list(self.cells.items()):
            if c[0] != LEAF or not self.is_free((x, y - 1, z)):
                continue
            if rng.random() > chance:
                continue
            n = rng.randint(1, max_len)
            for k in range(1, n + 1):
                q = (x, y - k, z)
                if q[1] < 1 or not self.is_free(q):
                    break
                states = {}
                if tip_state:
                    states = {tip_state: k == n}
                self.put(q, name, states, DECOR)

    # -- export ------------------------------------------------------------------
    def _finalize_leaves(self):
        logs = [p for p, c in self.cells.items() if c[0] == LOG]
        dist = {p: 0 for p in logs}
        frontier = list(logs)
        while frontier:
            nxt = []
            for (x, y, z) in frontier:
                for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0),
                          (0, 0, 1), (0, 0, -1)):
                    q = (x + d[0], y + d[1], z + d[2])
                    c = self.cells.get(q)
                    if c and c[0] == LEAF and q not in dist:
                        dist[q] = dist[(x, y, z)] + 1
                        nxt.append(q)
            frontier = nxt
        for p, c in self.cells.items():
            if c[0] == LEAF:
                far = dist.get(p, 99) > LEAF_DECAY_RANGE
                self.cells[p] = (LEAF, c[1], {"persistent_bit": far,
                                              "update_bit": False})

    def to_mcstructure(self):
        """Returns (bytes, size, ground_level) with the trunk centred."""
        self._finalize_leaves()
        xs = [p[0] for p in self.cells]
        ys = [p[1] for p in self.cells]
        zs = [p[2] for p in self.cells]
        cx, cz = self.trunk_center
        # Symmetric bounds around the trunk so "rotate_around_center" puts
        # the trunk exactly on the placement position.
        x0 = min(min(xs), math.floor(2 * cx - max(xs)))
        x1 = max(max(xs), math.ceil(2 * cx - min(xs)))
        z0 = min(min(zs), math.floor(2 * cz - max(zs)))
        z1 = max(max(zs), math.ceil(2 * cz - min(zs)))
        y0, y1 = -1, max(ys)
        sx, sy, sz = x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1

        palette, index = [], {}
        primary = [-1] * (sx * sy * sz)
        for (x, y, z), (_, name, states) in self.cells.items():
            key = (name, tuple(sorted(states.items())))
            if key not in index:
                index[key] = len(palette)
                palette.append({
                    "name": name,
                    "states": {k: _state_value(v) for k, v in states.items()},
                    "version": Int(BLOCK_VERSION),
                })
            i = ((x - x0) * sy + (y - y0)) * sz + (z - z0)   # ZYX order
            primary[i] = index[key]

        root = {
            "format_version": Int(1),
            "size": NbtList(TAG_INT, [sx, sy, sz]),
            "structure": {
                "block_indices": NbtList(TAG_LIST, [
                    NbtList(TAG_INT, primary),
                    NbtList(TAG_INT, [-1] * len(primary)),
                ]),
                "entities": NbtList(TAG_COMPOUND, []),
                "palette": {"default": {
                    "block_palette": NbtList(TAG_COMPOUND, palette),
                    "block_position_data": {},
                }},
            },
            "structure_world_origin": NbtList(TAG_INT, [0, 0, 0]),
        }
        return nbt_bytes(root), (sx, sy, sz), -y0

    def block_names(self):
        return {c[1] for c in self.cells.values()}


def solid_structure(name, size):
    """Structure completely filled with one block (used to carve with air)."""
    sx, sy, sz = size
    root = {
        "format_version": Int(1),
        "size": NbtList(TAG_INT, [sx, sy, sz]),
        "structure": {
            "block_indices": NbtList(TAG_LIST, [
                NbtList(TAG_INT, [0] * (sx * sy * sz)),
                NbtList(TAG_INT, [-1] * (sx * sy * sz)),
            ]),
            "entities": NbtList(TAG_COMPOUND, []),
            "palette": {"default": {
                "block_palette": NbtList(TAG_COMPOUND, [{
                    "name": name, "states": {},
                    "version": Int(BLOCK_VERSION)}]),
                "block_position_data": {},
            }},
        },
        "structure_world_origin": NbtList(TAG_INT, [0, 0, 0]),
    }
    return nbt_bytes(root)


# ---------------------------------------------------------------------------
# Species
# ---------------------------------------------------------------------------

def _center(width):
    c = -(width - 1) / 2 if width % 2 == 0 else 0.0
    return (c, c)


def _spread_yaws(rng, n):
    base = rng.uniform(0, math.tau)
    return [base + i * math.tau / n + rng.uniform(-0.45, 0.45)
            for i in range(n)]


def _point_on(path, frac):
    return path[min(len(path) - 1, int(frac * (len(path) - 1)))]


def broadleaf(rng, log, leaves, width, height, n_branches, branch_len,
              leaf_r, crown_r, branch_from=0.4, pitch=(0.25, 0.75),
              sub_branches=True, lean=0.0, roots=0, root_reach=2.5,
              squash=0.7, thick_branches=False, soil=None):
    t = Tree(log, leaves, trunk_center=_center(width))
    path = t.trunk(width, height, rng, lean=lean)
    if roots:
        t.roots(width, rng, roots, root_reach, soil)
    yaws = _spread_yaws(rng, n_branches)
    for i, yaw in enumerate(yaws):
        frac = branch_from + (1 - branch_from) * (i + rng.random()) / n_branches
        frac = min(frac, 0.92)
        start = _point_on(path, frac)
        length = rng.uniform(*branch_len) * (1.15 - 0.4 * frac)
        end = t.limb(start, yaw, rng.uniform(*pitch), length,
                     thickness=1 if thick_branches and frac < 0.6 else 0,
                     curve=rng.uniform(0.0, 0.35))
        t.cluster(end, rng.uniform(*leaf_r), rng, squash=squash)
        if sub_branches and length > 4:
            mid = (start[0] + (end[0] - start[0]) * 0.55,
                   start[1] + (end[1] - start[1]) * 0.55,
                   start[2] + (end[2] - start[2]) * 0.55)
            side = yaw + rng.choice((-1, 1)) * rng.uniform(0.6, 1.1)
            sub_end = t.limb(mid, side, rng.uniform(0.4, 0.9),
                             length * rng.uniform(0.35, 0.55))
            t.cluster(sub_end, rng.uniform(*leaf_r) * 0.8, rng, squash=squash)
    top = path[-1]
    t.cluster((top[0], top[1] + 1, top[2]), rng.uniform(*crown_r), rng,
              squash=squash, parts=5)
    return t


def mystic_oak(rng, i):
    """Huge, ancient oaks with many branches and many crowns."""
    width = 3 if i % 4 == 3 else 2
    height = rng.randint(16, 26) + width
    t = broadleaf(rng, "minecraft:oak_log", "minecraft:oak_leaves", width,
                  height, rng.randint(6, 9), (7, 11), (3.0, 4.2), (4.0, 5.2),
                  branch_from=0.35, pitch=(0.15, 0.6),
                  lean=rng.choice((0.0, 0.0, 0.015, 0.03)),
                  roots=rng.randint(5, 8), root_reach=rng.uniform(3, 5),
                  thick_branches=True, soil="minecraft:podzol")
    t.vines(rng, 0.05, 6)
    return t


def mighty_birch(rng, i):
    """Birch trunks 15 blocks taller than vanilla (20-22), side crowns."""
    ancient = i >= 17
    width = 2 if ancient else 1
    height = rng.randint(26, 30) if ancient else rng.randint(20, 22)
    return broadleaf(rng, "minecraft:birch_log", "minecraft:birch_leaves",
                     width, height, rng.randint(4, 7), (2.5, 4.5),
                     (2.0, 2.6), (2.6, 3.2), branch_from=0.55,
                     pitch=(0.5, 1.0), sub_branches=False, squash=1.15,
                     roots=3 if ancient else 0, root_reach=2)


def oak(rng, i):
    old = i >= 15
    width = 2 if old else 1
    height = rng.randint(12, 16) if old else rng.randint(8, 13)
    return broadleaf(rng, "minecraft:oak_log", "minecraft:oak_leaves", width,
                     height, rng.randint(3, 6), (3.5, 6.5), (2.4, 3.2),
                     (2.8, 3.5), branch_from=0.55, pitch=(0.4, 0.95),
                     roots=4 if old else rng.choice((0, 0, 3)),
                     root_reach=2.5, thick_branches=old)


def birch(rng, i):
    return broadleaf(rng, "minecraft:birch_log", "minecraft:birch_leaves", 1,
                     rng.randint(10, 15), rng.randint(3, 5), (2, 3.5),
                     (1.8, 2.4), (2.4, 3.0), branch_from=0.5,
                     pitch=(0.55, 1.0), sub_branches=False, squash=1.2)


def conifer(rng, log, leaves, width, height, bare, max_r, columnar=0.0,
            roots=0, soil=None, snowy=False):
    """Layered conifer: drooping whorls with gaps, no stepped pyramid."""
    t = Tree(log, leaves, trunk_center=_center(width))
    path = t.trunk(width, height, rng, wobble=0.15)
    if roots:
        t.roots(width, rng, roots, 2.5 + width, soil)
    y = int(height * bare)
    while y < height - 1:
        frac = (y - height * bare) / max(1, height * (1 - bare))
        taper = (1 - frac) ** 0.8
        r = max(1.2, max_r * (columnar + (1 - columnar) * taper)
                * rng.uniform(0.8, 1.15))
        c = _point_on(path, y / height)
        if rng.random() < 0.08:          # skipped whorl: visible gap
            y += rng.randint(2, 3)
            continue
        for yaw in _spread_yaws(rng, rng.randint(4, 6)):
            end = t.limb((c[0], y, c[2]), yaw, -0.1, r - 0.5,
                         droop=rng.uniform(0.2, 0.6))
            t.blob(end, 1.3, 0.8, 1.3, rng, ragged=0.4)
        t.disc((c[0], y, c[2]), r * rng.uniform(0.75, 1.0), rng,
               thickness=2, ragged=0.4)
        y += rng.randint(2, 3)
    top = path[-1]
    for k in range(1, 3):
        t.leaf_at((top[0], top[1] + k, top[2]))
    t.disc((top[0], top[1], top[2]), 1.5, rng, thickness=1, ragged=0.1)
    return t


def spruce(rng, i):
    big = i >= 16
    return conifer(rng, "minecraft:spruce_log", "minecraft:spruce_leaves",
                   2 if big else 1,
                   rng.randint(18, 24) if big else rng.randint(12, 19),
                   rng.uniform(0.15, 0.3), rng.uniform(3.0, 4.2),
                   columnar=rng.choice((0.0, 0.2, 0.45)),
                   roots=3 if big else 0)


def redwood(rng, i):
    width = 3 if i >= 14 else 2
    return conifer(rng, "minecraft:spruce_log", "minecraft:spruce_leaves",
                   width, rng.randint(28, 38), rng.uniform(0.4, 0.55),
                   rng.uniform(4.0, 5.5), columnar=rng.uniform(0.25, 0.5),
                   roots=rng.randint(5, 7), soil="minecraft:podzol")


def jungle(rng, i):
    small = i < 6
    t = broadleaf(rng, "minecraft:jungle_log", "minecraft:jungle_leaves",
                  1 if small else 2,
                  rng.randint(10, 14) if small else rng.randint(18, 28),
                  rng.randint(3, 6), (4, 7), (2.8, 3.6), (3.6, 4.6),
                  branch_from=0.6, pitch=(0.3, 0.7), squash=0.55,
                  roots=0 if small else rng.randint(4, 6), root_reach=3)
    t.vines(rng, 0.12, 7, on_trunk=True)
    return t


def acacia(rng, i):
    t = Tree("minecraft:acacia_log", "minecraft:acacia_leaves")
    stem = rng.randint(3, 6)
    path = t.trunk(1, stem, rng, wobble=0.0)
    base = path[-1]
    for yaw in _spread_yaws(rng, rng.randint(2, 3)):
        end = t.limb(base, yaw, rng.uniform(0.6, 0.95), rng.uniform(4, 7))
        r = rng.uniform(3.0, 4.3)
        t.disc((end[0], end[1] + 1, end[2]), r, rng, thickness=2)
    if rng.random() < 0.5:
        end = t.limb(base, 0, math.pi / 2, rng.uniform(3, 5))
        t.disc((end[0], end[1] + 1, end[2]), rng.uniform(2.5, 3.5), rng,
               thickness=2)
    return t


def _dome_tree(rng, log, leaves, width, height):
    t = Tree(log, leaves, trunk_center=_center(width))
    path = t.trunk(width, height, rng, wobble=0.2)
    t.roots(width, rng, rng.randint(4, 7), 3)
    for yaw in _spread_yaws(rng, rng.randint(4, 6)):
        start = _point_on(path, rng.uniform(0.55, 0.85))
        end = t.limb(start, yaw, rng.uniform(0.15, 0.45), rng.uniform(3, 5.5),
                     thickness=1 if width > 1 else 0)
        t.cluster((end[0], end[1] + 1, end[2]), rng.uniform(2.8, 3.6), rng,
                  squash=0.5)
    top = path[-1]
    r = rng.uniform(4.8, 6.0)
    t.blob((top[0], top[1] + 1, top[2]), r, 2.4, r, rng, flat_bottom=True)
    return t


def dark_oak(rng, i):
    return _dome_tree(rng, "minecraft:dark_oak_log", "minecraft:dark_oak_leaves",
                      3 if i >= 15 else 2, rng.randint(7, 11))


def pale_oak(rng, i):
    t = _dome_tree(rng, "minecraft:pale_oak_log", "minecraft:pale_oak_leaves",
                   3 if i >= 15 else 2, rng.randint(7, 11))
    t.hanging(rng, 0.12, 4, "minecraft:pale_hanging_moss", tip_state="tip")
    return t


def cherry(rng, i):
    t = Tree("minecraft:cherry_log", "minecraft:cherry_leaves")
    path = t.trunk(1, rng.randint(3, 5), rng, wobble=0.0)
    base = path[-1]
    for yaw in _spread_yaws(rng, rng.randint(2, 4)):
        end = t.limb(base, yaw, rng.uniform(0.2, 0.45), rng.uniform(4, 7),
                     curve=rng.uniform(0.5, 0.9))
        r = rng.uniform(3.2, 4.4)
        t.blob((end[0], end[1] + 1, end[2]), r, r * 0.55, r, rng)
    t.hanging(rng, 0.15, 2, "minecraft:cherry_leaves")
    return t


def mangrove(rng, i):
    t = Tree("minecraft:mangrove_log", "minecraft:mangrove_leaves")
    lift = rng.randint(2, 4)
    height = rng.randint(9, 14)
    path = t.trunk(1, height, rng, lean=0.02, start_y=lift)
    for yaw in _spread_yaws(rng, rng.randint(4, 7)):
        x, y, z = path[0][0], lift, path[0][2]
        reach = rng.uniform(2, 4)
        steps = int((reach + lift) * 2) + 2
        for s in range(steps + 1):
            f = s / steps
            px = x + math.cos(yaw) * reach * f
            pz = z + math.sin(yaw) * reach * f
            py = lift - (lift + 1) * f * f
            t.put((px, py, pz), "minecraft:mangrove_roots", {}, LOG)
    for yaw in _spread_yaws(rng, rng.randint(2, 4)):
        start = _point_on(path, rng.uniform(0.6, 0.85))
        end = t.limb(start, yaw, rng.uniform(0.3, 0.7), rng.uniform(2, 4))
        t.cluster(end, rng.uniform(2.4, 3.0), rng, squash=0.6)
    top = path[-1]
    t.cluster((top[0], top[1] + 1, top[2]), rng.uniform(3.2, 4.0), rng,
              squash=0.6)
    t.vines(rng, 0.05, 4)
    return t


def swamp_oak(rng, i):
    t = broadleaf(rng, "minecraft:oak_log", "minecraft:oak_leaves",
                  2 if i >= 16 else 1, rng.randint(6, 10), rng.randint(3, 5),
                  (3, 5), (2.6, 3.4), (3.6, 4.6), branch_from=0.5,
                  pitch=(0.1, 0.45), squash=0.45, roots=rng.randint(3, 5),
                  root_reach=2.5)
    t.vines(rng, 0.3, 6)
    return t


def poplar(rng, i):
    color = ("yellow", "yellow", "orange", "orange", "red")[i % 5]
    leaves = f"minecraft:{color}_poplar_leaves"
    t = Tree("minecraft:poplar_log", leaves)
    height = rng.randint(12, 18)
    path = t.trunk(1, height, rng, wobble=0.1)
    start = int(height * rng.uniform(0.3, 0.4))
    for yaw in _spread_yaws(rng, rng.randint(3, 5)):
        p = _point_on(path, rng.uniform(0.45, 0.8))
        t.limb(p, yaw, 1.1, rng.uniform(2, 3.5))
    y = start
    while y < height + 1:
        frac = (y - start) / max(1, height - start)
        r = rng.uniform(1.8, 2.7) * (1.1 - 0.45 * frac)
        c = _point_on(path, min(1.0, y / height))
        t.cluster((c[0], y + 1, c[2]), r, rng, squash=1.3, parts=3)
        y += rng.randint(2, 3)
    return t


SPECIES = {
    "mystic_oak": mystic_oak,
    "mighty_birch": mighty_birch,
    "oak": oak,
    "birch": birch,
    "spruce": spruce,
    "redwood": redwood,
    "jungle": jungle,
    "acacia": acacia,
    "dark_oak": dark_oak,
    "pale_oak": pale_oak,
    "cherry": cherry,
    "mangrove": mangrove,
    "swamp_oak": swamp_oak,
    "poplar": poplar,
}


def generate(species, variant, namespace):
    seed = f"{namespace}:{species}:{variant}"
    rng = random.Random(seed)
    return SPECIES[species](rng, variant)
