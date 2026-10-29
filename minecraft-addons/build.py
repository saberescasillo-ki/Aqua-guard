#!/usr/bin/env python3
"""
Generates and packages the two Minecraft Bedrock add-ons:

  * BREATHE OF THE WILD  - three new overworld biomes (Mystic Forest,
                           Mighty Birch Forest, No Man's Land).
  * BREATHE OF THE TREES - bigger, branchier versions of every vanilla tree.

Trees are designed in treegen.py and shipped as .mcstructure files
(20 variants per species).

Everything is built from vanilla blocks only. Run:

    python3 build.py

It (re)writes the pack folders next to this script, validates every block
identifier against Mojang's vanilla block list (if available) and writes
.mcaddon files into ./dist.
"""

import json
import os
import shutil
import struct
import sys
import zipfile
import zlib

import treegen

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")

MIN_ENGINE = [1, 26, 40]
FEATURE_FMT = "1.13.0"
BLOCK_FEATURE_FMT = "1.21.40"
NEW_FEATURE_FMT = "1.26.40"
BIOME_FMT = "1.26.0"
CLIENT_BIOME_FMT = "1.21.120"

VERSION = [2, 0, 0]

UUIDS = {
    "botw_bp": "399882bf-3a8d-46bd-ad24-5283eb4ea059",
    "botw_bp_data": "c8043372-c698-4fce-a42d-31209801cf60",
    "botw_rp": "9e3a4593-734e-49e4-9242-61cb5e3f5142",
    "botw_rp_res": "0b304093-f09a-4e36-8dcc-146e6faae71c",
    "bott_bp": "5769b0cd-7e54-4be4-815f-a9f5de97db85",
    "bott_bp_data": "17abb3fe-0c0e-421c-9f18-c2f784460d8f",
}

USED_BLOCKS = set()


def b(name, **states):
    """Vanilla block reference, recorded for validation."""
    full = name if ":" in name else "minecraft:" + name
    USED_BLOCKS.add(full)
    if states:
        return {"name": full, "states": states}
    return full


def blocks(*names):
    return [b(n) for n in names]


def chance(num, den):
    return {"numerator": num, "denominator": den}


def rng(lo, hi):
    return {"range_min": lo, "range_max": hi}


# ---------------------------------------------------------------------------
# Shared block lists
# ---------------------------------------------------------------------------

LEAVES = [
    "oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves",
    "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "cherry_leaves",
    "pale_oak_leaves", "azalea_leaves", "azalea_leaves_flowered",
    "orange_poplar_leaves", "red_poplar_leaves", "yellow_poplar_leaves",
]

PLANTS = [
    "short_grass", "tall_grass", "fern", "large_fern", "vine", "snow_layer",
    "leaf_litter", "wildflowers", "pink_petals", "moss_carpet",
    "pale_moss_carpet", "firefly_bush", "bush", "deadbush", "short_dry_grass",
    "tall_dry_grass", "dandelion", "poppy", "blue_orchid", "allium",
    "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip",
    "oxeye_daisy", "cornflower", "lily_of_the_valley", "sunflower", "lilac",
    "rose_bush", "peony", "brown_mushroom", "red_mushroom", "sweet_berry_bush",
    "open_eyeblossom", "closed_eyeblossom",
]

SOILS = [
    "grass_block", "dirt", "podzol", "coarse_dirt", "dirt_with_roots",
    "moss_block", "mud",
]

TREE_MAY_GROW_ON = blocks(*SOILS)
TREE_MAY_REPLACE = blocks("air", *LEAVES, *PLANTS)
TREE_MAY_GROW_THROUGH = blocks(*SOILS, *PLANTS)

# Everything natural terrain is made of; No Man's Land removes all of it.
TERRAIN = [
    "stone", "granite", "diorite", "andesite", "deepslate", "tuff", "calcite",
    "dirt", "coarse_dirt", "grass_block", "podzol", "dirt_with_roots", "mud",
    "moss_block", "clay", "gravel", "sand", "red_sand", "sandstone",
    "red_sandstone", "dripstone_block", "pointed_dripstone", "smooth_basalt",
    "amethyst_block", "budding_amethyst", "infested_stone",
    "infested_deepslate", "coal_ore", "iron_ore", "copper_ore", "gold_ore",
    "redstone_ore", "lapis_ore", "emerald_ore", "diamond_ore",
    "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_copper_ore",
    "deepslate_gold_ore", "deepslate_redstone_ore", "deepslate_lapis_ore",
    "deepslate_emerald_ore", "deepslate_diamond_ore", "glow_lichen",
    *PLANTS,
]


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

class Pack:
    def __init__(self, path):
        self.path = path
        self.files = {}

    def put(self, rel, data):
        self.files[rel] = data

    def feature(self, ident, ftype, body, fmt=FEATURE_FMT):
        name = ident.split(":", 1)[1]
        self.put(f"features/{name}.json", {
            "format_version": fmt,
            ftype: {"description": {"identifier": ident}, **body},
        })
        return ident

    def rule(self, ident, places, biome_filter, distribution, placement_pass):
        name = ident.split(":", 1)[1]
        self.put(f"feature_rules/{name}.json", {
            "format_version": FEATURE_FMT,
            "minecraft:feature_rules": {
                "description": {"identifier": ident, "places_feature": places},
                "conditions": {
                    "placement_pass": placement_pass,
                    "minecraft:biome_filter": biome_filter,
                },
                "distribution": distribution,
            },
        })

    def write(self):
        if os.path.isdir(self.path):
            shutil.rmtree(self.path)
        for rel, data in sorted(self.files.items()):
            full = os.path.join(self.path, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            if isinstance(data, bytes):
                with open(full, "wb") as f:
                    f.write(data)
            elif isinstance(data, str):
                with open(full, "w", encoding="utf-8", newline="\n") as f:
                    f.write(data)
            else:
                with open(full, "w", encoding="utf-8", newline="\n") as f:
                    json.dump(data, f, indent=2)
                    f.write("\n")


def tag(value, op="=="):
    return {"test": "has_biome_tag", "operator": op, "value": value}


def surface_scatter(iterations, chance_=None, margin=0):
    """Rule distribution: random columns in the chunk, on the surface."""
    extent = [margin, 15 - margin]
    dist = {
        "iterations": iterations,
        "coordinate_eval_order": "xzy",
        "x": {"distribution": "uniform", "extent": extent},
        "y": "query.heightmap(variable.worldx, variable.worldz)",
        "z": {"distribution": "uniform", "extent": extent},
    }
    if chance_:
        dist["scatter_chance"] = chance_
    return dist


def tree(pack, ident, trunk_key, trunk, canopy_key=None, canopy=None,
         base_block="dirt", extra=None):
    body = {
        "base_block": [b(base_block)],
        "may_grow_on": TREE_MAY_GROW_ON,
        "may_replace": TREE_MAY_REPLACE,
        "may_grow_through": TREE_MAY_GROW_THROUGH,
        trunk_key: trunk,
    }
    if canopy_key:
        body[canopy_key] = canopy
    if extra:
        body.update(extra)
    return pack.feature(ident, "minecraft:tree_feature", body)


def weighted(pack, ident, entries):
    return pack.feature(ident, "minecraft:weighted_random_feature", {
        "features": [[f, w] for f, w in entries],
    })


def plant(pack, ident, entries):
    """Single surface plant that must survive on the block below it."""
    return pack.feature(ident, "minecraft:single_block_feature", {
        "places_block": [{"block": blk, "weight": w} for blk, w in entries],
        "enforce_placement_rules": True,
        "enforce_survivability_rules": True,
        "may_replace": [b("air")],
    }, fmt=BLOCK_FEATURE_FMT)


def shelf_mushrooms(pack, ns):
    return pack.feature(
        f"{ns}:shelf_mushroom_log_decoration_feature",
        "minecraft:horizontal_tree_decoration_feature",
        {"places_block": b("shelf_mushroom"), "allow_adjacent": False,
         "bark_side_only": True},
        fmt=NEW_FEATURE_FMT)


def fallen_log(pack, ident, log, length, decoration):
    return tree(pack, ident, "fallen_trunk", {
        "log_length": length,
        "stump_height": rng(1, 2),
        "trunk_block": b(log),
        "log_decoration_feature": decoration,
    })


# Structure trees ---------------------------------------------------------

VARIANTS = 20
# Blocks a tree structure may overwrite. Leaves and logs are left out on
# purpose so a tree never lands on top of (or inside) another tree.
TREE_ALLOW = [*PLANTS, *SOILS, "air"]


def structure_trees(pack, ns, species, extra_allow=()):
    """VARIANTS designed trees of one species, picked at random."""
    allow = blocks(*TREE_ALLOW, *extra_allow)
    entries = []
    for i in range(VARIANTS):
        t = treegen.generate(species, i, ns)
        data, _, ground = t.to_mcstructure()
        for name in t.block_names():
            b(name)
        name = f"{species}_{i + 1:02d}"
        pack.put(f"structures/{ns}/{name}.mcstructure", data)
        entries.append((pack.feature(
            f"{ns}:{name}_feature", "minecraft:structure_template_feature", {
                "structure_name": f"{ns}:{name}",
                "adjustment_radius": 4,
                "facing_direction": "south",
                "rotate_around_center": True,
                "ground_level": ground,
                "constraints": {"block_intersection": {
                    "block_allowlist": allow,
                    "only_check_intersection_for_motion_blocking_blocks": True,
                }},
            }), 1))
    return weighted(pack, f"{ns}:{species}_trees_feature", entries)


# ---------------------------------------------------------------------------
# Manifests, texts and icons
# ---------------------------------------------------------------------------

def manifest(name, desc, header_uuid, module_uuid, module_type, deps=()):
    data = {
        "format_version": 2,
        "header": {
            "name": "pack.name",
            "description": "pack.description",
            "uuid": header_uuid,
            "version": VERSION,
            "min_engine_version": MIN_ENGINE,
        },
        "modules": [{
            "type": module_type,
            "uuid": module_uuid,
            "version": VERSION,
        }],
        "metadata": {"authors": ["saberescasillo"]},
    }
    if deps:
        data["dependencies"] = [{"uuid": d, "version": VERSION} for d in deps]
    return data


def texts(pack, name, desc):
    pack.put("texts/languages.json", ["en_US"])
    pack.put("texts/en_US.lang", f"pack.name={name}\npack.description={desc}\n")


def png(pixels, size):
    """Minimal RGBA PNG writer (pixels: list of rows of (r,g,b,a))."""
    raw = b"".join(b"\x00" + b"".join(struct.pack("BBBB", *p) for p in row)
                   for row in pixels)

    def chunk(kind, data):
        c = struct.pack(">I", len(data)) + kind + data
        return c + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def icon(sky_top, sky_bottom, trunk, leaves, ground):
    """16x16 pixel-art tree scene, upscaled to 128x128."""
    art = [
        "................",
        "......LLLL......",
        "....LLLLLLLL....",
        "...LLLLLLLLLL...",
        "..LLLLLLLLLLLL..",
        "..LLLLLTLLLLLL..",
        "...LLLLTLLLLL...",
        ".LLL.LLTLL.LLL..",
        "LLLLTLLTTLTLLLL.",
        ".LLL..TTTT.LLL..",
        "......TTTT......",
        "......TTTT......",
        "......TTTT......",
        "GGGGGGGGGGGGGGGG",
        "GGGGGGGGGGGGGGGG",
        "GGGGGGGGGGGGGGGG",
    ]
    size, scale = 128, 8
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            ch = art[y // scale][x // scale]
            if ch == "L":
                c = leaves
            elif ch == "T":
                c = trunk
            elif ch == "G":
                c = ground
            else:
                t = y / size
                c = tuple(int(sky_top[i] * (1 - t) + sky_bottom[i] * t)
                          for i in range(3))
            row.append((*c, 255))
        rows.append(row)
    return png(rows, size)


# ---------------------------------------------------------------------------
# BREATHE OF THE WILD
# ---------------------------------------------------------------------------

def build_botw():
    bp = Pack(os.path.join(ROOT, "breathe-of-the-wild", "behavior_pack"))
    rp = Pack(os.path.join(ROOT, "breathe-of-the-wild", "resource_pack"))
    name = "BREATHE OF THE WILD"
    desc = ("Three new vanilla-block biomes: Mystic Forest, Mighty Birch "
            "Forest and No Man's Land.")
    bp.put("manifest.json", manifest(name, desc, UUIDS["botw_bp"],
                                     UUIDS["botw_bp_data"], "data",
                                     deps=[UUIDS["botw_rp"]]))
    rp.put("manifest.json", manifest(name, desc, UUIDS["botw_rp"],
                                     UUIDS["botw_rp_res"], "resources"))
    for p in (bp, rp):
        texts(p, name, desc)
        p.put("pack_icon.png", icon((120, 190, 230), (200, 235, 245),
                                    (102, 76, 46), (52, 140, 60),
                                    (96, 160, 64)))

    shelf = shelf_mushrooms(bp, "botw")
    mystic_forest(bp, rp, shelf)
    mighty_birch(bp, rp, shelf)
    no_mans_land(bp, rp)
    return bp, rp


def biome(pack, ident, climate, surface, tags, replacements, extra=None):
    comps = {
        "minecraft:climate": climate,
        "minecraft:overworld_height": {"noise_type": "default"},
        "minecraft:surface_builder": {"builder": surface},
        "minecraft:replace_biomes": {"replacements": replacements},
        "minecraft:tags": {"tags": tags},
    }
    if extra:
        comps.update(extra)
    name = ident.split(":", 1)[1]
    pack.put(f"biomes/{name}.biome.json", {
        "format_version": BIOME_FMT,
        "minecraft:biome": {"description": {"identifier": ident},
                            "components": comps},
    })


def client_biome(pack, ident, components):
    name = ident.split(":", 1)[1]
    pack.put(f"biomes/{name}.client_biome.json", {
        "format_version": CLIENT_BIOME_FMT,
        "minecraft:client_biome": {"description": {"identifier": ident},
                                   "components": components},
    })


def fog(pack, ident, air_color, start, end, water_color):
    name = ident.split(":", 1)[1]
    pack.put(f"fogs/{name}.json", {
        "format_version": "1.16.100",
        "minecraft:fog_settings": {
            "description": {"identifier": ident},
            "distance": {
                "air": {"fog_start": start, "fog_end": end,
                        "fog_color": air_color,
                        "render_distance_type": "render"},
                "water": {"fog_start": 0.0, "fog_end": 60.0,
                          "fog_color": water_color,
                          "render_distance_type": "fixed"},
            },
        },
    })


def overworld_surface(top, mid="dirt", foundation="stone"):
    return {
        "type": "minecraft:overworld",
        "sea_floor_depth": 7,
        "sea_floor_material": b("gravel"),
        "foundation_material": b(foundation),
        "mid_material": b(mid),
        "top_material": b(top),
        "sea_material": b("water"),
    }


def replacement(targets, amount, scale):
    return {"dimension": "minecraft:overworld",
            "targets": [f"minecraft:{t}" for t in targets],
            "amount": amount, "noise_frequency_scale": scale}


def mystic_forest(bp, rp, shelf):
    ident = "botw:mystic_forest"
    biome(bp, ident,
          climate={"downfall": 0.9, "snow_accumulation": [0.0, 0.125],
                   "temperature": 0.65},
          surface=overworld_surface("grass_block"),
          tags=["animal", "monster", "overworld", "botw",
                "botw_mystic_forest"],
          replacements=[replacement(["forest", "flower_forest"], 0.4, 25)],
          extra={"minecraft:surface_material_adjustments": {"adjustments": [
              {"materials": {"top_material": b("podzol")},
               "noise_frequency_scale": 0.0625, "noise_range": [0.25, 0.55]},
              {"materials": {"top_material": b("moss_block")},
               "noise_frequency_scale": 0.0625, "noise_range": [-0.6, -0.35]},
          ]}})
    fog(rp, "botw:fog_mystic_forest", "#a7c9c1", 0.35, 0.95, "#2b6f6a")
    client_biome(rp, ident, {
        "minecraft:sky_color": {"sky_color": "#8fbcc4"},
        "minecraft:fog_appearance": {"fog_identifier": "botw:fog_mystic_forest"},
        "minecraft:water_appearance": {"surface_color": "#2f8f86"},
        "minecraft:grass_appearance": {"color": "#4c9a52"},
        "minecraft:foliage_appearance": {"color": "#3d8a45"},
    })

    oak, leaf = "oak_log", "oak_leaves"
    trees = structure_trees(bp, "botw", "mystic_oak")

    bush = tree(bp, "botw:mystic_oak_bush_feature", "trunk", {
        "trunk_height": 1,
        "trunk_block": b(oak),
    }, "random_spread_canopy", {
        "canopy_height": 2, "canopy_radius": 3, "leaf_placement_attempts": 45,
        "leaf_blocks": [[b(leaf), 1]],
    })
    fallen = fallen_log(bp, "botw:mystic_fallen_oak_feature", oak,
                        rng(6, 10), shelf)

    f = [tag("botw_mystic_forest")]
    bp.rule("botw:mystic_forest_trees_rule", trees, f,
            surface_scatter(3, margin=2), "before_surface_pass")
    bp.rule("botw:mystic_forest_bushes_rule", bush, f,
            surface_scatter(3), "surface_pass")
    bp.rule("botw:mystic_forest_fallen_oak_rule", fallen, f,
            surface_scatter(1, chance(1, 3)), "surface_pass")

    ground = plant(bp, "botw:mystic_forest_ground_cover_feature", [
        (b("short_grass"), 6), (b("fern"), 4), (b("moss_carpet"), 2),
        (b("leaf_litter", growth=3), 2), (b("leaf_litter", growth=1), 2),
    ])
    flowers = plant(bp, "botw:mystic_forest_flowers_feature", [
        (b("lily_of_the_valley"), 3), (b("azure_bluet"), 2),
        (b("oxeye_daisy"), 1), (b("allium"), 1), (b("blue_orchid"), 1),
    ])
    glow = plant(bp, "botw:mystic_forest_glow_feature", [
        (b("firefly_bush"), 3), (b("brown_mushroom"), 2),
        (b("red_mushroom"), 1),
    ])
    bp.rule("botw:mystic_forest_ground_cover_rule", ground, f,
            surface_scatter(56), "surface_pass")
    bp.rule("botw:mystic_forest_flowers_rule", flowers, f,
            surface_scatter(4, chance(1, 2)), "surface_pass")
    bp.rule("botw:mystic_forest_glow_rule", glow, f,
            surface_scatter(4), "surface_pass")


def mighty_birch(bp, rp, shelf):
    ident = "botw:mighty_birch_forest"
    biome(bp, ident,
          climate={"downfall": 0.6, "snow_accumulation": [0.0, 0.125],
                   "temperature": 0.6},
          surface=overworld_surface("grass_block"),
          tags=["animal", "monster", "overworld", "birch", "bee_habitat",
                "botw", "botw_mighty_birch"],
          replacements=[replacement(["birch_forest", "birch_forest_mutated"],
                                    0.5, 25)])
    client_biome(rp, ident, {
        "minecraft:water_appearance": {"surface_color": "#0677ce"},
        "minecraft:grass_appearance": {"color": "#8ab66a"},
        "minecraft:foliage_appearance": {"color": "#80a755"},
    })

    # Vanilla birch trunks are 5-7 blocks; these are 15 blocks taller (20-22).
    trees = structure_trees(bp, "botw", "mighty_birch")
    fallen = fallen_log(bp, "botw:mighty_fallen_birch_feature", "birch_log",
                        rng(5, 9), shelf)

    f = [tag("botw_mighty_birch")]
    bp.rule("botw:mighty_birch_trees_rule", trees, f,
            surface_scatter(4, margin=2), "before_surface_pass")
    bp.rule("botw:mighty_birch_fallen_rule", fallen, f,
            surface_scatter(1, chance(1, 3)), "surface_pass")

    ground = plant(bp, "botw:mighty_birch_ground_cover_feature", [
        (b("short_grass"), 8), (b("fern"), 1),
        (b("leaf_litter", growth=2), 1),
    ])
    flowers = plant(bp, "botw:mighty_birch_flowers_feature", [
        (b("wildflowers", growth=3), 4), (b("lily_of_the_valley"), 2),
        (b("dandelion"), 2), (b("oxeye_daisy"), 1), (b("cornflower"), 1),
    ])
    bp.rule("botw:mighty_birch_ground_cover_rule", ground, f,
            surface_scatter(40), "surface_pass")
    bp.rule("botw:mighty_birch_flowers_rule", flowers, f,
            surface_scatter(6), "surface_pass")


# No Man's Land: the whole biome area is hollowed out down to the deepslate.
PIT_FLOOR_Y = -33       # top solid layer of the pit floor
PIT_TOP_Y = 127         # highest block that gets removed
PIT_SLICE = 32          # height of one air slice structure


def grid_scatter(pack, ident, places, axis, extent, iterations=None):
    """Scatter that walks a fixed 1-D grid along one axis."""
    coords = {"x": 0, "y": 0, "z": 0}
    coords[axis] = {"distribution": "fixed_grid", "extent": extent}
    return pack.feature(ident, "minecraft:scatter_feature", {
        "places_feature": places,
        "iterations": iterations or (extent[1] - extent[0] + 1),
        **coords,
    })


def chunk_grid_rule(pack, ident, row_feature, y, filt, placement_pass):
    """Rule that walks x = 0..15; the row feature then walks z."""
    pack.rule(ident, row_feature, filt, {
        "iterations": 16,
        "x": {"distribution": "fixed_grid", "extent": [0, 15]},
        "y": y,
        "z": 0,
    }, placement_pass)


def no_mans_land(bp, rp):
    ident = "botw:no_mans_land"
    biome(bp, ident,
          climate={"downfall": 0.0, "snow_accumulation": [0.0, 0.0],
                   "temperature": 2.0},
          surface=overworld_surface("coarse_dirt", mid="gravel"),
          tags=["monster", "overworld", "botw", "botw_no_mans_land"],
          replacements=[replacement(["savanna", "desert"], 0.3, 20)],
          extra={"minecraft:creature_spawn_probability": {"probability": 0.0}})
    fog(rp, "botw:fog_no_mans_land", "#9c876a", 0.25, 0.85, "#3f3a2c")
    client_biome(rp, ident, {
        "minecraft:sky_color": {"sky_color": "#c2a983"},
        "minecraft:fog_appearance": {"fog_identifier": "botw:fog_no_mans_land"},
        "minecraft:water_appearance": {"surface_color": "#5b5a3a"},
        "minecraft:grass_appearance": {"color": "#9a8f5a"},
        "minecraft:foliage_appearance": {"color": "#8d8250"},
        "minecraft:precipitation": {"white_ash": 0.15},
    })
    f = [tag("botw_no_mans_land")]

    # 1) Hollow out the whole chunk from the floor up to the sky by stamping
    #    stacked 16x32x16 slices of air (structures overwrite every block,
    #    water and lava included).
    bp.put("structures/botw/pit_slice.mcstructure",
           treegen.solid_structure(b("air"), (16, PIT_SLICE, 16)))
    pit_slice = bp.feature("botw:no_mans_land_pit_slice_feature",
                           "minecraft:structure_template_feature", {
                               "structure_name": "botw:pit_slice",
                               "facing_direction": "south",
                               "rotate_around_center": False,
                               "constraints": {},
                           })
    slices = (PIT_TOP_Y - PIT_FLOOR_Y) // PIT_SLICE
    column = bp.feature("botw:no_mans_land_carve_column_feature",
                        "minecraft:scatter_feature", {
                            "places_feature": pit_slice,
                            "iterations": slices,
                            "x": 0,
                            "y": {"distribution": "fixed_grid",
                                  "extent": [0, (slices - 1) * PIT_SLICE],
                                  "step_size": PIT_SLICE},
                            "z": 0,
                        })
    bp.rule("botw:no_mans_land_carve_rule", column, f, {
        "iterations": 1, "x": 0, "y": PIT_FLOOR_Y + 1, "z": 0,
    }, "first_pass")

    # 2) Repaint the exposed floor with a rough, scorched mix.
    floor_block = bp.feature("botw:no_mans_land_floor_block_feature",
                             "minecraft:single_block_feature", {
                                 "places_block": [
                                     {"block": b("deepslate"), "weight": 6},
                                     {"block": b("tuff"), "weight": 3},
                                     {"block": b("cobbled_deepslate"), "weight": 2},
                                     {"block": b("coarse_dirt"), "weight": 3},
                                     {"block": b("gravel"), "weight": 2},
                                     {"block": b("smooth_basalt"), "weight": 1},
                                     {"block": b("blackstone"), "weight": 1},
                                     {"block": b("magma"), "weight": 1},
                                 ],
                                 "enforce_placement_rules": False,
                                 "enforce_survivability_rules": False,
                                 "may_replace": blocks(*TERRAIN),
                             }, fmt=BLOCK_FEATURE_FMT)
    floor_row = grid_scatter(bp, "botw:no_mans_land_floor_row_feature",
                             floor_block, "z", [0, 15])
    chunk_grid_rule(bp, "botw:no_mans_land_floor_rule", floor_row,
                    PIT_FLOOR_Y, f, "after_underground_pass")

    # 3) Lava pools sunk into the floor.
    lava = bp.feature("botw:no_mans_land_lava_pool_feature",
                      "minecraft:ore_feature", {
                          "count": 28,
                          "replace_rules": [{
                              "places_block": b("lava"),
                              "may_replace": blocks(
                                  "deepslate", "tuff", "cobbled_deepslate",
                                  "coarse_dirt", "gravel", "smooth_basalt",
                                  "blackstone", "magma"),
                          }],
                      })
    bp.rule("botw:no_mans_land_lava_pool_rule", lava, f, {
        "iterations": 1,
        "scatter_chance": chance(1, 3),
        "x": {"distribution": "uniform", "extent": [2, 13]},
        "y": PIT_FLOOR_Y - 1,
        "z": {"distribution": "uniform", "extent": [2, 13]},
    }, "surface_pass")

    # 4) Jagged stone pillars rising from the floor.
    pillar_block = bp.feature("botw:no_mans_land_pillar_block_feature",
                              "minecraft:single_block_feature", {
                                  "places_block": [
                                      {"block": b("basalt"), "weight": 3},
                                      {"block": b("deepslate"), "weight": 2},
                                      {"block": b("tuff"), "weight": 2},
                                      {"block": b("blackstone"), "weight": 1},
                                  ],
                                  "enforce_placement_rules": False,
                                  "enforce_survivability_rules": False,
                                  "may_replace": [b("air")],
                              }, fmt=BLOCK_FEATURE_FMT)
    pillar = bp.feature("botw:no_mans_land_pillar_feature",
                        "minecraft:scatter_feature", {
                            "places_feature": pillar_block,
                            "iterations": "math.random_integer(4, 16)",
                            "x": 0,
                            "y": {"distribution": "fixed_grid",
                                  "extent": [0, 15]},
                            "z": 0,
                        })
    bp.rule("botw:no_mans_land_pillar_rule", pillar, f, {
        "iterations": 2,
        "scatter_chance": chance(1, 2),
        "x": {"distribution": "uniform", "extent": [1, 14]},
        "y": PIT_FLOOR_Y + 1,
        "z": {"distribution": "uniform", "extent": [1, 14]},
    }, "surface_pass")

    # 5) Dead scrub on the floor and glowing lichen on the cliff walls.
    scrub = plant(bp, "botw:no_mans_land_scrub_feature", [
        (b("deadbush"), 3), (b("short_dry_grass"), 3),
        (b("tall_dry_grass"), 1),
    ])
    bp.rule("botw:no_mans_land_scrub_rule", scrub, f, {
        "iterations": 12,
        "x": {"distribution": "uniform", "extent": [0, 15]},
        "y": PIT_FLOOR_Y + 1,
        "z": {"distribution": "uniform", "extent": [0, 15]},
    }, "after_surface_pass")

    lichen = bp.feature("botw:no_mans_land_lichen_feature",
                        "minecraft:multiface_feature", {
                            "places_block": b("glow_lichen"),
                            "search_range": 6,
                            "can_place_on_floor": False,
                            "can_place_on_ceiling": True,
                            "can_place_on_wall": True,
                            "chance_of_spreading": 0.6,
                            "can_place_on": blocks(
                                "stone", "deepslate", "tuff", "granite",
                                "diorite", "andesite", "cobbled_deepslate"),
                        })
    bp.rule("botw:no_mans_land_lichen_rule", lichen, f, {
        "iterations": 24,
        "x": {"distribution": "uniform", "extent": [0, 15]},
        "y": {"distribution": "uniform", "extent": [PIT_FLOOR_Y + 1, 40]},
        "z": {"distribution": "uniform", "extent": [0, 15]},
    }, "after_surface_pass")

    # 6) Extra-wide caves branching off under the pit floor.
    caves = bp.feature("botw:no_mans_land_cave_carver_feature",
                       "minecraft:cave_carver_feature", {
                           "fill_with": b("air"),
                           "width_modifier": 2.5,
                           "skip_carve_chance": 3,
                       })
    bp.rule("botw:no_mans_land_cave_carver_rule", caves, f,
            {"iterations": 1, "x": 0, "y": 0, "z": 0}, "pregeneration_pass")


# ---------------------------------------------------------------------------
# BREATHE OF THE TREES
# ---------------------------------------------------------------------------

def build_bott():
    bp = Pack(os.path.join(ROOT, "breathe-of-the-trees", "behavior_pack"))
    name = "BREATHE OF THE TREES"
    desc = ("Bigger, taller and branchier versions of every vanilla tree, "
            "plus fallen logs. Vanilla blocks only.")
    bp.put("manifest.json", manifest(name, desc, UUIDS["bott_bp"],
                                     UUIDS["bott_bp_data"], "data"))
    texts(bp, name, desc)
    bp.put("pack_icon.png", icon((250, 170, 120), (255, 225, 180),
                                 (110, 80, 50), (64, 150, 54),
                                 (100, 150, 60)))

    shelf = shelf_mushrooms(bp, "bott")
    not_botw = tag("botw", "!=")

    def rule(name_, feature, filt, iterations, chance_=None,
             placement_pass="before_surface_pass"):
        bp.rule(f"bott:{name_}_rule", feature, [*filt, not_botw],
                surface_scatter(iterations, chance_, margin=2),
                placement_pass)

    def trees(species, **kw):
        return structure_trees(bp, "bott", species, **kw)

    # --- Oak ---------------------------------------------------------------
    oaks = trees("oak")
    oak_biomes = [{"any_of": [tag("oak_forest"), tag("flower_forest"),
                              {"all_of": [tag("forest"),
                                          tag("extreme_hills")]}]}]
    rule("oak_trees", oaks, oak_biomes, 2)
    rule("plains_lone_oak", oaks, [tag("plains")], 1, chance(1, 8))
    rule("fallen_oak", fallen_log(bp, "bott:fallen_oak_feature", "oak_log",
                                  rng(4, 7), shelf),
         oak_biomes, 1, chance(1, 3), "surface_pass")

    # --- Birch -------------------------------------------------------------
    birch_biomes = [tag("birch")]
    rule("birch_trees", trees("birch"), birch_biomes, 2)
    rule("fallen_birch", fallen_log(bp, "bott:fallen_birch_feature",
                                    "birch_log", rng(4, 7), shelf),
         birch_biomes, 1, chance(1, 3), "surface_pass")

    # --- Spruce (taiga, snowy taiga, grove) ----------------------------------
    spruce_biomes = [{"any_of": [{"all_of": [tag("taiga"), tag("mega", "!=")]},
                                 tag("grove")]}]
    rule("spruce_trees", trees("spruce"), spruce_biomes, 2)
    rule("fallen_spruce", fallen_log(bp, "bott:fallen_spruce_feature",
                                     "spruce_log", rng(5, 8), shelf),
         spruce_biomes, 1, chance(1, 3), "surface_pass")

    # --- Old growth (mega) taiga -------------------------------------------
    rule("ancient_redwood", trees("redwood"), [tag("taiga"), tag("mega")], 1,
         chance(1, 2))

    # --- Other forests ------------------------------------------------------
    rule("jungle_trees", trees("jungle"), [tag("jungle")], 2)
    rule("acacia_trees", trees("acacia"), [tag("savanna")], 1, chance(1, 2))
    rule("dark_oak_trees", trees("dark_oak"), [tag("roofed")], 2)
    rule("fallen_dark_oak", fallen_log(bp, "bott:fallen_dark_oak_feature",
                                       "dark_oak_log", rng(4, 7), shelf),
         [tag("roofed")], 1, chance(1, 4), "surface_pass")
    rule("pale_oak_trees", trees("pale_oak"), [tag("pale_garden")], 1)
    rule("cherry_trees", trees("cherry"), [tag("cherry_grove")], 1,
         chance(1, 2))
    rule("mangrove_trees", trees("mangrove",
                                 extra_allow=("water", "flowing_water")),
         [tag("mangrove_swamp")], 1)
    rule("swamp_oak_trees", trees("swamp_oak", extra_allow=("water",)),
         [tag("swamp")], 1)
    rule("poplar_trees", trees("poplar"), [tag("dappled_forest")], 2)

    return bp


# ---------------------------------------------------------------------------
# Validation and packaging
# ---------------------------------------------------------------------------

def validate_blocks():
    """Check every block id against Mojang's vanilla block list."""
    candidates = [
        os.environ.get("BEDROCK_BLOCKS_JSON", ""),
        os.path.join(ROOT, "..", "..", "bedrock-samples", "metadata",
                     "vanilladata_modules", "mojang-blocks.json"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                known = {i["name"] for i in json.load(f)["data_items"]}
            unknown = sorted(USED_BLOCKS - known)
            if unknown:
                sys.exit(f"Unknown block identifiers: {unknown}")
            print(f"Validated {len(USED_BLOCKS)} block ids against {path}")
            return
    print("Vanilla block list not found; skipped block validation "
          "(set BEDROCK_BLOCKS_JSON to mojang-blocks.json).")


def validate_references(packs):
    """Every places_feature / feature reference must exist in the pack."""
    for pack in packs:
        defined = set()
        refs = []
        for rel, data in pack.files.items():
            if rel.startswith("features/"):
                for key, body in data.items():
                    if key.startswith("minecraft:"):
                        ident = body["description"]["identifier"]
                        assert rel == f"features/{ident.split(':', 1)[1]}.json", rel
                        defined.add(ident)
                        for k in ("places_feature", "log_decoration_feature"):
                            if k in body:
                                refs.append((rel, body[k]))
                        if "structure_name" in body:
                            ns, path = body["structure_name"].split(":", 1)
                            assert f"structures/{ns}/{path}.mcstructure" in \
                                pack.files, body["structure_name"]
                        for k in ("fallen_trunk",):
                            if k in body and "log_decoration_feature" in body[k]:
                                refs.append((rel, body[k]["log_decoration_feature"]))
                        for f, _ in body.get("features", []):
                            refs.append((rel, f))
            elif rel.startswith("feature_rules/"):
                refs.append((rel, data["minecraft:feature_rules"]
                             ["description"]["places_feature"]))
        missing = [(r, f) for r, f in refs if f not in defined]
        if missing:
            sys.exit(f"Missing feature references: {missing}")


def zip_dir(zf, src, prefix):
    for dirpath, _, filenames in os.walk(src):
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            zf.write(full, os.path.join(prefix, os.path.relpath(full, src)))


def package(filename, folders):
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, filename)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder, prefix in folders:
            zip_dir(zf, folder, prefix)
    print("Wrote", os.path.relpath(out, ROOT))


def main():
    botw_bp, botw_rp = build_botw()
    bott_bp = build_bott()
    packs = [botw_bp, botw_rp, bott_bp]
    validate_blocks()
    validate_references(packs)
    for p in packs:
        p.write()
    package("BREATHE_OF_THE_WILD.mcaddon", [
        (botw_bp.path, "BREATHE_OF_THE_WILD_BP"),
        (botw_rp.path, "BREATHE_OF_THE_WILD_RP"),
    ])
    package("BREATHE_OF_THE_TREES.mcaddon", [
        (bott_bp.path, "BREATHE_OF_THE_TREES_BP"),
    ])


if __name__ == "__main__":
    main()
