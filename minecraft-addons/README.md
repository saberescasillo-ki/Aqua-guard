# BREATHE OF THE WILD & BREATHE OF THE TREES

Two Minecraft **Bedrock Edition** add-ons that change world generation using
**vanilla blocks only**: no custom blocks, textures or entities.

| Add-on | File | What it does |
| --- | --- | --- |
| BREATHE OF THE WILD | `dist/BREATHE_OF_THE_WILD.mcaddon` | Adds 4 new overworld biomes |
| BREATHE OF THE TREES | `dist/BREATHE_OF_THE_TREES.mcaddon` | Adds bigger, branchier procedural versions of the vanilla trees |

Built for Minecraft Bedrock **1.26.60** (the latest version).

## Installing

1. Open the `.mcaddon` file on your device. Minecraft imports it automatically.
2. Create a **new world** (world generation only affects new chunks).
3. Under **Behavior Packs**, activate the add-on. *BREATHE OF THE WILD* also
   turns on its resource pack.
4. **BREATHE OF THE WILD only:** if your version shows a **Custom Biomes**
   toggle under **Experiments**, turn it on before creating the world.
5. When updating from an older version of these add-ons, delete the old
   packs first (Settings → Storage) so the new version is the one used.
6. Both add-ons can run together. *BREATHE OF THE TREES* skips the three
   *BREATHE OF THE WILD* biomes so they keep their own trees.

Find the new biomes with:

```
/locate biome botw:no_mans_land
/locate biome botw:the_oak
/locate biome botw:the_birch
/locate biome botw:the_poplar
```

## Tree shapes
The big trees of *BREATHE OF THE WILD* are hand-shaped **structures**
(`.mcstructure`), not the game's built-in tree generator. `treegen.py`
designs each species from a seed and saves **30 variations per tree type**;
the game picks one at random each time.

- Broadleaf trees have a real trunk, root flares, branches that fork, and a
  fluffy leaf cluster at the end of every branch. No pyramid canopies.
- A tree is never placed on top of, or inside, another tree.
- Every tree stands on a small **grass-topped soil island**, so on slopes
  and uneven ground it never hangs half in the air.
- Trees, plants and fallen logs check the biome at their exact position, so
  they only appear inside their own biome.
- The biomes are deliberately rare: each one replaces only a small share of
  its vanilla biome.

## BREATHE OF THE WILD

### No Man's Land (`botw:no_mans_land`)
Replaces part of the Savanna and Desert biomes with an enormous open pit.

- The biome is hollowed out into a huge bowl that reaches **Y −32**, deep in
  the deepslate layer. The pit does not drop straight down: every column's
  depth depends on how far it is from the biome's edge, so the ground slopes
  and terraces down over roughly 40 blocks before reaching the bottom.
  The slopes show ore veins and cave cross-sections.
- The slopes and the floor are a scorched mix of deepslate, tuff, cobbled
  deepslate, coarse dirt, gravel, smooth basalt, blackstone and magma.
- Lava pools, jagged basalt/deepslate/tuff pillars, dead bushes, dry grass,
  glow lichen on the walls and extra-wide caves under the floor.
- Dusty fog, a pale ochre sky, falling white ash, no rain and no animal spawns.

**Be careful:** the slopes get steep toward the middle of the pit.

### The Oak, The Birch, The Poplar
Variants of the vanilla Forest, Birch Forest and Dappled Forest. Each one
grows **only** the structure trees of its species (the 20 designs that
*BREATHE OF THE TREES* 2.0 used plus 10 new ones), with no vanilla trees
mixed in.

| Biome | Replaces part of | Trees |
| --- | --- | --- |
| The Oak (`botw:the_oak`) | Forest | 30 oak designs (5 old 2×2 oaks, 10 spreading oaks), fallen oak logs |
| The Birch (`botw:the_birch`) | Birch Forest, Old Growth Birch Forest | 30 birch designs (10 leaning birches), fallen birch logs |
| The Poplar (`botw:the_poplar`) | Dappled Forest | 30 poplar designs in yellow, orange and red (10 tall grand poplars) |

## BREATHE OF THE TREES

Rebuilt from scratch as a small, simple procedural pack: the game grows each
tree from `tree_feature` data, so every tree is different. There is one
improved design per tree type, and none of them uses the stepped, pyramid
canopies. The big trees are placed before vanilla trees, which fill the gaps.

| Biome | New tree |
| --- | --- |
| Forest, Flower Forest, Plains (rare) | Big Oak (many branches) and Branching Oak |
| Birch Forests | Tall Birch, 11–15 blocks with side crowns |
| Taiga, Snowy Taiga, Grove | Tall Spruce with layered side crowns |
| Old Growth Taiga | Giant 2×2 Spruce, 24–31 blocks |
| Jungles | Big 2×2 Jungle tree with wide branches |
| Savannas | Big leaning Acacia |
| Dark Forest / Pale Garden | Big 2×2 Dark Oak / Pale Oak |
| Cherry Grove | Big Cherry with two or three branches |
| Swamp | Big Swamp Oak |

### Limits
- In Bedrock, vanilla trees and sapling growth are built into the game and
  cannot be edited by add-ons. This pack therefore **adds** improved trees
  alongside the vanilla ones; it does not replace them. Saplings still grow
  into vanilla trees.
- Lush-cave azalea trees are not changed.

## Rebuilding

The pack folders and `.mcaddon` files are generated by `build.py`:

```sh
python3 build.py
```

To check every block id against Mojang's official list, download
[`mojang-blocks.json`](https://github.com/Mojang/bedrock-samples/blob/main/metadata/vanilladata_modules/mojang-blocks.json)
and run:

```sh
BEDROCK_BLOCKS_JSON=path/to/mojang-blocks.json python3 build.py
```

## Notes
- No Man's Land checks the biome around every column while generating, so
  chunks in that biome may load a little slower on low-end devices.
- Trees use a fixed orientation so vines stay attached; the 20 variations
  per species give the variety instead of rotation.
- If something does not generate, open **Settings → Creator → Content Log**
  to see the error.
