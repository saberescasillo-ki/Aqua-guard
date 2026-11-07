#!/usr/bin/env python3
"""
Generates and packages the two Minecraft Bedrock add-ons:

  * BREATHE OF THE Nature - overworld - "Truly mutated" variants of vanilla
      forests, a colossal pine forest and a cave grove, all grown from
      designed structure trees.
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
import math
import os
import shutil
import struct
import sys
import zipfile
import zlib

import treegen

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")

MIN_ENGINE = [1, 26, 60]
FEATURE_FMT = "1.13.0"
BLOCK_FEATURE_FMT = "1.21.40"
NEW_FEATURE_FMT = "1.26.40"
CONDITIONAL_FMT = "1.26.50"
BIOME_FMT = "1.26.50"
CLIENT_BIOME_FMT = "1.21.120"

VERSION = [1, 1, 0]          # BREATHE OF THE Nature - overworld
BOTT_VERSION = [7, 0, 0]     # BREATHE OF THE TREES

UUIDS = {
    "botn_bp": "ed919a5d-3661-4c19-9199-8e8d82994125",
    "botn_bp_data": "4bd6c3b4-b68c-41c4-8661-ebf13df6c6c5",
    "botn_rp": "53f88819-39c6-4666-a9f6-aeeb7c8f69f3",
    "botn_rp_res": "4c19bb9f-e8aa-43df-a3b4-126bdcfdfa0a",
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

# Natural underground blocks a cave tree may grow into.
CAVE_ROCK = [
    "stone", "granite", "diorite", "andesite", "deepslate", "tuff", "calcite",
    "gravel", "clay", "dripstone_block", "pointed_dripstone", "moss_block",
    "moss_carpet", "glow_lichen", "cave_vines", "cave_vines_body_with_berries",
    "cave_vines_head_with_berries", "hanging_roots", "dirt_with_roots",
    "azalea", "flowering_azalea", "small_dripleaf_block", "big_dripleaf",
]


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

class Pack:
    def __init__(self, path, exact_biomes=False):
        self.path = path
        self.files = {}
        # Feature rules attach to every chunk that contains a bit of the
        # biome. With exact_biomes, each placement also checks the biome at
        # its own position, so nothing spills into neighbouring biomes.
        self.exact_biomes = exact_biomes
        self.check_y = {}       # biome tag -> y used for the position check

    def put(self, rel, data):
        self.files[rel] = data

    def feature(self, ident, ftype, body, fmt=FEATURE_FMT):
        name = ident.split(":", 1)[1]
        self.put(f"features/{name}.json", {
            "format_version": fmt,
            ftype: {"description": {"identifier": ident}, **body},
        })
        return ident

    def rule(self, ident, places, biome_filter, distribution, placement_pass,
             check_offset=0, check=True):
        name = ident.split(":", 1)[1]
        # Cave carvers must sit directly in pregeneration_pass, so they are
        # never wrapped.
        if (check and self.exact_biomes and len(biome_filter) == 1
                and placement_pass != "pregeneration_pass"):
            biome_tag = biome_filter[0]["value"]
            # variable.worldy does not exist in feature Molang, and biomes are
            # 3D (replace_biomes only swaps the surface layer), so the biome
            # is checked at the column's surface height.
            x = f"variable.worldx + {check_offset}" if check_offset else "variable.worldx"
            z = f"variable.worldz + {check_offset}" if check_offset else "variable.worldz"
            y = self.check_y.get(biome_tag, f"query.heightmap({x}, {z})")
            places = self.feature(
                ident.replace("_rule", "_biome_check_feature"),
                "minecraft:conditional_list", {
                    "conditional_features": [{
                        "places_feature": places,
                        "condition": f"query.has_biome_tag('{biome_tag}', "
                                     f"{x}, {y}, {z})",
                    }],
                    "early_out_scheme": "condition_success",
                }, fmt=CONDITIONAL_FMT)
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

# Blocks a tree structure may overwrite. Leaves and logs are left out on
# purpose so a tree never lands on top of (or inside) another tree.
# Natural ground (and mountain snow/ice) is allowed so the soil island and
# roots can sink into any terrain, including steep and snowy slopes.
TREE_ALLOW = [*PLANTS, *SOILS, "air", "stone", "granite", "diorite",
              "andesite", "tuff", "calcite", "deepslate", "gravel", "sand",
              "red_sand", "sandstone", "clay", "snow", "powder_snow", "ice",
              "packed_ice", "blue_ice", "dripstone_block", "pointed_dripstone",
              "coal_ore", "iron_ore", "copper_ore", "gold_ore", "lapis_ore",
              "redstone_ore", "emerald_ore", "diamond_ore", "glow_lichen",
              "water", "flowing_water"]


def designs(species, variants, seed_ns, remap=None):
    """Design list for structure_trees: one entry per variant number."""
    return [(species, v, seed_ns, remap) for v in variants]


def structure_trees(pack, ns, name, tree_designs, island="minecraft:grass_block",
                    island_fill="minecraft:dirt", extra_allow=()):
    """One structure per design, picked at random.

    tree_designs: (species, variant, seed_ns, remap) tuples. The seed
    namespace picks the design set: "bott" and "botw" reproduce the trees
    earlier releases shipped, "botn" holds the new ones.
    """
    allow = blocks(*TREE_ALLOW, *extra_allow)
    entries = []
    for k, (species, variant, seed_ns, remap) in enumerate(tree_designs, 1):
        t = treegen.generate(species, variant, seed_ns, island=island,
                             island_fill=island_fill, remap=remap)
        data, _, ground = t.to_mcstructure()
        for block in t.block_names():
            b(block)
        sname = f"{name}_{k:02d}"
        pack.put(f"structures/{ns}/{sname}.mcstructure", data)
        entries.append((pack.feature(
            f"{ns}:{sname}_feature", "minecraft:structure_template_feature", {
                "structure_name": f"{ns}:{sname}",
                "adjustment_radius": 4,
                "facing_direction": "south",
                "rotate_around_center": True,
                "ground_level": ground,
                "constraints": {"block_intersection": {
                    "block_allowlist": allow,
                    "only_check_intersection_for_motion_blocking_blocks": True,
                }},
            }), 1))
    return weighted(pack, f"{ns}:{name}_trees_feature", entries)


# ---------------------------------------------------------------------------
# Manifests, texts and icons
# ---------------------------------------------------------------------------

def manifest(name, desc, header_uuid, module_uuid, module_type, deps=(),
             version=VERSION):
    data = {
        "format_version": 2,
        "header": {
            "name": "pack.name",
            "description": "pack.description",
            "uuid": header_uuid,
            "version": version,
            "min_engine_version": MIN_ENGINE,
        },
        "modules": [{
            "type": module_type,
            "uuid": module_uuid,
            "version": version,
        }],
        "metadata": {"authors": ["saberescasillo"]},
    }
    if deps:
        data["dependencies"] = [{"uuid": d, "version": version} for d in deps]
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

def build_botn():
    bp = Pack(os.path.join(ROOT, "breathe-of-the-nature-overworld",
                           "behavior_pack"), exact_biomes=True)
    rp = Pack(os.path.join(ROOT, "breathe-of-the-nature-overworld",
                           "resource_pack"))
    name = "BREATHE OF THE Nature - overworld"
    desc = ("Truly mutated forests, a colossal pine forest and a cave grove, "
            "grown from hand-shaped trees. Vanilla blocks only.")
    bp.put("manifest.json", manifest(name, desc, UUIDS["botn_bp"],
                                     UUIDS["botn_bp_data"], "data",
                                     deps=[UUIDS["botn_rp"]]))
    rp.put("manifest.json", manifest(name, desc, UUIDS["botn_rp"],
                                     UUIDS["botn_rp_res"], "resources"))
    with open(os.path.join(ROOT, "assets", "pack_icon_nature.png"), "rb") as f:
        icon_png = f.read()
    for p in (bp, rp):
        texts(p, name, desc)
        p.put("pack_icon.png", icon_png)

    shelf = shelf_mushrooms(bp, "botn")
    truly_mutated_forest(bp, rp, shelf)
    truly_mutated_birch_forest(bp, rp, shelf)
    truly_mutated_jungle(bp, rp)
    truly_mutated_dappled_forest(bp, rp)
    colossal_pine_forest(bp, rp)
    deep_grove(bp, rp)
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


VANILLA_CLIENT_BIOMES = os.environ.get(
    "BEDROCK_CLIENT_BIOMES", os.path.join(ROOT, "assets", "client_biomes"))


def client_biome(pack, ident, look_like):
    """Client biome that looks like a vanilla one (sky, water, grass and
    foliage colours, fog, music), from assets/client_biomes/."""
    with open(os.path.join(VANILLA_CLIENT_BIOMES,
                           f"{look_like}.client_biome.json")) as f:
        components = json.load(f)["minecraft:client_biome"]["components"]
    name = ident.split(":", 1)[1]
    pack.put(f"biomes/{name}.client_biome.json", {
        "format_version": CLIENT_BIOME_FMT,
        "minecraft:client_biome": {"description": {"identifier": ident},
                                   "components": components},
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


# noise_frequency_scale: lower values give bigger, continuous patches that
# show up less often; high values (20+) scatter tiny chunk-sized fragments.
PATCH_SCALE = 3
# Each new biome takes this share of the vanilla biomes it replaces (both
# the normal and the mutated variant).
SHARE = 0.35


def replacement(targets, amount=SHARE, scale=PATCH_SCALE):
    return {"dimension": "minecraft:overworld",
            "targets": [f"minecraft:{t}" for t in targets],
            "amount": amount, "noise_frequency_scale": scale}


def forest_biome(bp, rp, key, targets, look_like, climate, trees,
                 trees_per_chunk, ground, flowers, extra_tags=(),
                 fallen=None, tree_chance=None, surface_extra=None):
    """Surface biome grown only from structure trees."""
    ident = f"botn:{key}"
    biome(bp, ident, climate=climate,
          surface=overworld_surface("grass_block"),
          tags=["animal", "monster", "overworld", "bee_habitat", "botn",
                f"botn_{key}", *extra_tags],
          replacements=[replacement(targets)], extra=surface_extra)
    client_biome(rp, ident, look_like)
    f = [tag(f"botn_{key}")]
    bp.rule(f"botn:{key}_trees_rule", trees, f,
            surface_scatter(trees_per_chunk, tree_chance, margin=2),
            "before_surface_pass")
    bp.rule(f"botn:{key}_ground_cover_rule",
            plant(bp, f"botn:{key}_ground_cover_feature", ground), f,
            surface_scatter(40), "surface_pass")
    bp.rule(f"botn:{key}_flowers_rule",
            plant(bp, f"botn:{key}_flowers_feature", flowers), f,
            surface_scatter(5), "surface_pass")
    if fallen:
        bp.rule(f"botn:{key}_fallen_log_rule", fallen, f,
                surface_scatter(1, chance(1, 3)), "surface_pass")


TEMPERATE = {"downfall": 0.8, "snow_accumulation": [0.0, 0.125],
             "temperature": 0.7}


def truly_mutated_forest(bp, rp, shelf):
    # Tall, slim-based oaks.
    trees = structure_trees(bp, "botn", "oak",
                            designs("tall_oak", range(30), "botn"))
    forest_biome(
        bp, rp, "truly_mutated_forest", ["forest", "flower_forest"], "forest",
        TEMPERATE, trees, 4,
        [(b("short_grass"), 8), (b("fern"), 1), (b("leaf_litter", growth=2), 1)],
        [(b("dandelion"), 2), (b("poppy"), 2), (b("lily_of_the_valley"), 1),
         (b("oxeye_daisy"), 1)],
        fallen=fallen_log(bp, "botn:oak_fallen_log_feature", "oak_log",
                          rng(4, 7), shelf))


def truly_mutated_birch_forest(bp, rp, shelf):
    trees = structure_trees(bp, "botn", "birch",
                            designs("birch", range(30), "bott"))
    forest_biome(
        bp, rp, "truly_mutated_birch_forest",
        ["birch_forest", "birch_forest_mutated"], "birch_forest",
        {"downfall": 0.6, "snow_accumulation": [0.0, 0.125],
         "temperature": 0.6},
        trees, 5,
        [(b("short_grass"), 8), (b("fern"), 1)],
        [(b("wildflowers", growth=3), 3), (b("lily_of_the_valley"), 1),
         (b("dandelion"), 1), (b("cornflower"), 1)],
        extra_tags=["birch"],
        fallen=fallen_log(bp, "botn:birch_fallen_log_feature", "birch_log",
                          rng(4, 7), shelf))


JUNGLE_WOOD = {
    "minecraft:oak_log": "minecraft:jungle_log",
    "minecraft:oak_wood": "minecraft:jungle_wood",
    "minecraft:oak_leaves": "minecraft:jungle_leaves",
}


def truly_mutated_jungle(bp, rp):
    # The vine-draped giants (the old Mystic Forest shapes), in jungle wood.
    trees = structure_trees(
        bp, "botn", "jungle",
        designs("mystic_oak", range(30), "botw", JUNGLE_WOOD))
    forest_biome(
        bp, rp, "truly_mutated_jungle", ["jungle", "jungle_mutated"], "jungle",
        {"downfall": 0.9, "snow_accumulation": [0.0, 0.125],
         "temperature": 0.95},
        trees, 2,
        [(b("short_grass"), 6), (b("fern"), 4), (b("bush"), 1)],
        [(b("poppy"), 2), (b("dandelion"), 1), (b("blue_orchid"), 1)],
        extra_tags=["spawns_jungle_mobs"])


def truly_mutated_dappled_forest(bp, rp):
    # Half of the old autumn poplars plus 15 new maples.
    kept_poplars = [*range(10), *range(20, 25)]
    trees = structure_trees(
        bp, "botn", "autumn",
        designs("poplar", kept_poplars, "bott") +
        designs("maple", range(15), "botn"))
    forest_biome(
        bp, rp, "truly_mutated_dappled_forest", ["dappled_forest"],
        "dappled_forest",
        {"downfall": 0.6, "snow_accumulation": [0.0, 0.125],
         "temperature": 0.6},
        trees, 4,
        [(b("short_grass"), 6), (b("fern"), 2), (b("leaf_litter", growth=3), 3),
         (b("leaf_litter", growth=1), 2)],
        [(b("azure_bluet"), 1), (b("oxeye_daisy"), 1), (b("cornflower"), 1),
         (b("brown_mushroom"), 1)])


def colossal_pine_forest(bp, rp):
    trees = structure_trees(bp, "botn", "colossal_pine",
                            designs("colossal_pine", range(20), "botn"))
    # One tree per chunk with a 2/3 chance: about one per 384 square
    # blocks, i.e. roughly one colossal pine every 20 blocks.
    forest_biome(
        bp, rp, "colossal_pine_forest", ["taiga", "mega_taiga"], "mega_taiga",
        {"downfall": 0.8, "snow_accumulation": [0.0, 0.125],
         "temperature": 0.3},
        trees, 1,
        [(b("short_grass"), 5), (b("fern"), 5), (b("sweet_berry_bush"), 1)],
        [(b("lily_of_the_valley"), 1), (b("brown_mushroom"), 1)],
        tree_chance=chance(2, 3),
        surface_extra={"minecraft:surface_material_adjustments": {
            "adjustments": [
                {"materials": {"top_material": b("podzol")},
                 "noise_frequency_scale": 0.0625, "noise_range": [-0.1, 0.25]},
                {"materials": {"top_material": b("coarse_dirt")},
                 "noise_frequency_scale": 0.0625, "noise_range": [0.25, 1.0]},
            ]}})


def deep_grove(bp, rp):
    """Cave biome with low, glowing azalea trees on the cave floors."""
    ident = "botn:deep_grove"
    key_tag = "botn_deep_grove"
    biome(bp, ident,
          climate={"downfall": 0.0, "temperature": 0.9},
          surface=overworld_surface("grass_block"),
          tags=["caves", "overworld", "monster", "botn", key_tag],
          replacements=[replacement(["lush_caves", "dripstone_caves"])])
    client_biome(rp, ident, "lush_caves")
    trees = structure_trees(bp, "botn", "cave_tree",
                            designs("cave_tree", range(20), "botn"),
                            island="minecraft:moss_block",
                            island_fill="minecraft:dirt_with_roots",
                            extra_allow=CAVE_ROCK)

    def on_floor(name, feature):
        # Snapping keeps the placement inside the biome.
        return bp.feature(f"botn:deep_grove_{name}_on_floor_feature",
                          "minecraft:snap_to_surface_feature", {
                              "feature_to_snap": feature,
                              "search_range": 12,
                              "surface": "floor",
                          }, fmt=CONDITIONAL_FMT)

    moss = plant(bp, "botn:deep_grove_ground_cover_feature", [
        (b("moss_carpet"), 6), (b("azalea"), 1), (b("flowering_azalea"), 1)])
    # Cave biomes are 3D: rules are placed at underground heights so they
    # only fire where the cave biome itself is.
    # Most random points land inside rock (snapping only starts in air),
    # so many attempts are made per chunk.
    for name, feature, iterations in (("trees", trees, 64),
                                      ("ground_cover", moss, 96)):
        bp.rule(f"botn:deep_grove_{name}_rule", on_floor(name, feature),
                [tag(key_tag)], {
                    "iterations": iterations,
                    "x": {"distribution": "uniform", "extent": [2, 13]},
                    "y": {"distribution": "uniform", "extent": [-54, 40]},
                    "z": {"distribution": "uniform", "extent": [2, 13]},
                }, "before_surface_pass", check=False)


# ---------------------------------------------------------------------------
# BREATHE OF THE TREES
# ---------------------------------------------------------------------------

def build_bott():
    """Simple procedural trees: the game grows them from tree_feature data.

    One improved design per vanilla tree, no stepped/pyramid canopies.
    """
    bp = Pack(os.path.join(ROOT, "breathe-of-the-trees", "behavior_pack"))
    name = "BREATHE OF THE TREES"
    desc = ("Bigger, taller and branchier versions of the vanilla trees, "
            "generated procedurally. Vanilla blocks only.")
    bp.put("manifest.json", manifest(name, desc, UUIDS["bott_bp"],
                                     UUIDS["bott_bp_data"], "data",
                                     version=BOTT_VERSION))
    texts(bp, name, desc)
    bp.put("pack_icon.png", icon((250, 170, 120), (255, 225, 180),
                                 (110, 80, 50), (64, 150, 54),
                                 (100, 150, 60)))
    not_botn = tag("botn", "!=")

    def leaves(leaf, height, radius):
        return {"height": height, "radius": radius, "leaf_block": b(leaf)}

    def branchy(ident, log, leaf, width, height, branch_length, branch_r,
                crown, **kw):
        """Straight trunk with side branches, a leaf ball on every branch."""
        return tree(bp, ident, "mega_trunk", {
            "trunk_width": width,
            "trunk_height": height,
            "trunk_block": b(log),
            "branches": {
                "branch_length": branch_length,
                "branch_slope": kw.pop("slope", 0.4),
                "branch_interval": rng(2, 3),
                "branch_altitude_factor": {"min": kw.pop("low", 0.5),
                                           "max": 0.9},
                "branch_canopy": {"fancy_canopy": leaves(leaf, 3, branch_r)},
            },
        }, "fancy_canopy", leaves(leaf, *crown), **kw)

    def fancy(ident, log, leaf, base, variance, crown):
        """Vanilla-style big oak shape: many branches with leaf clusters."""
        return tree(bp, ident, "fancy_trunk", {
            "trunk_height": {"base": base, "variance": variance, "scale": 1.0},
            "trunk_width": 1,
            "branches": {"slope": 0.35, "density": 1.1,
                         "min_altitude_factor": 0.35},
            "trunk_block": b(log),
            "width_scale": 1.1,
            "foliage_altitude_factor": 0.35,
        }, "fancy_canopy", leaves(leaf, *crown))

    def roofed(leaf):
        return {"canopy_height": 4, "core_width": 2, "outer_radius": 4,
                "inner_radius": 3, "leaf_block": b(leaf)}

    def add(name_, feature, filt, per_chunk, chance_=None):
        bp.rule(f"bott:{name_}_rule", feature, [*filt, not_botn],
                surface_scatter(per_chunk, chance_), "before_surface_pass")

    oak = weighted(bp, "bott:oak_trees_feature", [
        (fancy("bott:big_oak_feature", "oak_log", "oak_leaves", 9, 6, (4, 2)), 3),
        (branchy("bott:branching_oak_feature", "oak_log", "oak_leaves", 1,
                 {"base": 9, "intervals": [4]}, 4, 2, (4, 2)), 2),
    ])
    add("oak_trees", oak, [{"any_of": [tag("oak_forest"), tag("flower_forest"),
                                       tag("plains")]}], 1, chance(1, 2))

    add("birch_trees", branchy("bott:tall_birch_feature", "birch_log",
                               "birch_leaves", 1, {"base": 11, "intervals": [5]},
                               3, 2, (4, 2), slope=0.5),
        [tag("birch")], 2)

    add("spruce_trees", branchy("bott:tall_spruce_feature", "spruce_log",
                                "spruce_leaves", 1,
                                {"base": 14, "intervals": [6]}, 3, 2, (3, 2),
                                slope=0.15, low=0.3),
        [{"any_of": [{"all_of": [tag("taiga"), tag("mega", "!=")]},
                     tag("grove")]}], 2)

    add("giant_spruce_trees", branchy("bott:giant_spruce_feature",
                                      "spruce_log", "spruce_leaves", 2,
                                      {"base": 24, "intervals": [8]}, 5, 3,
                                      (3, 2), slope=0.15, low=0.4),
        [tag("taiga"), tag("mega")], 1)

    add("jungle_trees", branchy("bott:big_jungle_feature", "jungle_log",
                                "jungle_leaves", 2,
                                {"base": 20, "intervals": [8]}, 6, 3, (4, 3),
                                slope=0.3, low=0.6),
        [tag("jungle")], 1)

    add("acacia_trees", tree(bp, "bott:big_acacia_feature", "acacia_trunk", {
        "trunk_width": 1,
        "trunk_height": {"base": 7, "intervals": [3, 3],
                         "min_height_for_canopy": 5},
        "trunk_lean": {"allow_diagonal_growth": True,
                       "lean_height": rng(3, 4), "lean_steps": rng(3, 5),
                       "lean_length": rng(1, 3)},
        "trunk_block": b("acacia_log"),
    }, "acacia_canopy", {"canopy_size": 3, "leaf_block": b("acacia_leaves"),
                         "simplify_canopy": False}),
        [tag("savanna")], 1, chance(1, 2))

    for log in ("dark_oak", "pale_oak"):
        feature = tree(bp, f"bott:big_{log}_feature", "mega_trunk", {
            "trunk_width": 2,
            "trunk_height": {"base": 9, "intervals": [4]},
            "trunk_block": b(f"{log}_log"),
        }, "roofed_canopy", roofed(f"{log}_leaves"))
        add(f"{log}_trees", feature,
            [tag("roofed" if log == "dark_oak" else "pale_garden")], 1)

    cherry_leaves = {"leaf_block": b("cherry_leaves"), "height": rng(5, 6),
                     "radius": rng(4, 5), "trunk_width": 1,
                     "wide_bottom_layer_hole_chance": chance(1, 4),
                     "corner_hole_chance": chance(1, 4),
                     "hanging_leaves_chance": chance(1, 6),
                     "hanging_leaves_extension_chance": chance(1, 3)}
    add("cherry_trees", tree(bp, "bott:big_cherry_feature", "cherry_trunk", {
        "trunk_block": b("cherry_log"),
        "trunk_height": {"base": 8, "intervals": [3]},
        "branches": {
            "tree_type_weights": {"one_branch": 0, "two_branches": 2,
                                  "two_branches_and_trunk": 3},
            "branch_horizontal_length": rng(3, 5),
            "branch_start_offset_from_top": rng(-5, -3),
            "branch_end_offset_from_top": rng(-1, 1),
            "branch_canopy": {"cherry_canopy": cherry_leaves},
        },
    }, "cherry_canopy", cherry_leaves), [tag("cherry_grove")], 1, chance(1, 2))

    add("swamp_oak_trees", tree(bp, "bott:big_swamp_oak_feature", "trunk", {
        "trunk_height": rng(6, 9),
        "can_be_submerged": {"max_depth": 2},
        "trunk_block": b("oak_log"),
    }, "fancy_canopy", leaves("oak_leaves", 3, 3)), [tag("swamp")], 1)

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
                        for f in body.get("features", []):
                            # weighted lists hold [id, weight] pairs
                            refs.append((rel, f[0] if isinstance(f, list) else f))
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
    botn_bp, botn_rp = build_botn()
    bott_bp = build_bott()
    packs = [botn_bp, botn_rp, bott_bp]
    validate_blocks()
    validate_references(packs)
    for p in packs:
        p.write()
    package("BREATHE_OF_THE_NATURE_OVERWORLD.mcaddon", [
        (botn_bp.path, "BREATHE_OF_THE_NATURE_OVERWORLD_BP"),
        (botn_rp.path, "BREATHE_OF_THE_NATURE_OVERWORLD_RP"),
    ])
    package("BREATHE_OF_THE_TREES.mcaddon", [
        (bott_bp.path, "BREATHE_OF_THE_TREES_BP"),
    ])


if __name__ == "__main__":
    main()
