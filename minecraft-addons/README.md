# BREATHE OF THE WILD & BREATHE OF THE TREES

Two Minecraft **Bedrock Edition** add-ons that change world generation using
**vanilla blocks only**: no custom blocks, textures or entities.

| Add-on | File | What it does |
| --- | --- | --- |
| BREATHE OF THE WILD | `dist/BREATHE_OF_THE_WILD.mcaddon` | Adds 3 new overworld biomes |
| BREATHE OF THE TREES | `dist/BREATHE_OF_THE_TREES.mcaddon` | Adds bigger, branchier versions of every vanilla tree |

Built for Minecraft Bedrock **1.26.40 or newer**.

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
/locate biome botw:mystic_forest
/locate biome botw:mighty_birch_forest
/locate biome botw:no_mans_land
```

## Tree shapes
Every big tree is a hand-shaped **structure** (`.mcstructure`), not the
game's built-in tree generator. `treegen.py` designs each species from a
seed and saves **20 variations per tree type** (280 trees in total), and the
game picks one at random each time.

- Broadleaf trees have a real trunk, root flares, branches that fork, and a
  fluffy leaf cluster at the end of every branch. No pyramid canopies.
- Conifers are layered: uneven drooping whorls with gaps, not a clean cone.
- A tree is never placed on top of, or inside, another tree.

## BREATHE OF THE WILD

### Mystic Forest (`botw:mystic_forest`)
Replaces part of the Forest and Flower Forest biomes. Its trees are all oak:

- **20 Mystic Oaks**: 2×2 or 3×3 trunks 18–29 blocks tall, buttress roots
  over a podzol patch, 6–9 thick branches that fork, a crown on every
  branch, and hanging vines. Some of them lean.
- Oak bushes, fallen oak logs with shelf mushrooms, ferns, moss, leaf
  litter, firefly bushes, mushrooms and lily of the valley.
- Podzol and moss patches, deep green grass, and a misty teal fog.

### Mighty Birch Forest (`botw:mighty_birch_forest`)
Replaces part of the Birch Forest and Old Growth Birch Forest biomes.

- **20 Mighty Birches**: trunks 20–22 blocks tall (vanilla birch trunks are
  5–7, so 15 blocks taller), bare lower trunk, side branches with their own
  crowns. Three of the variants are rare 2×2 **Ancient Birches** (26–30).
- Fallen birch logs, wildflowers, lily of the valley and dandelions.

### No Man's Land (`botw:no_mans_land`)
Replaces part of the Savanna and Desert biomes with an enormous open pit.

- Every block in the biome is removed from **Y 127 down to Y −32** by
  stacked air structures, so the
  biome becomes a canyon whose cliff walls drop straight into the deepslate
  layer. The walls show ore veins and cave cross-sections.
- The floor (Y −33) is a scorched mix of deepslate, tuff, cobbled deepslate,
  coarse dirt, gravel, smooth basalt, blackstone and magma.
- Lava pools, jagged basalt/deepslate/tuff pillars, dead bushes, dry grass,
  glow lichen on the walls and extra-wide caves under the floor.
- Dusty fog, a pale ochre sky, falling white ash, no rain and no animal spawns.

**Be careful:** walking into this biome from outside means a fall of up to
150 blocks.

## BREATHE OF THE TREES

Adds 20 designed variations of every vanilla tree type to the biomes where
it grows. The big trees are placed before vanilla trees, so they take the
best spots and vanilla trees fill the gaps.

| Biome | New trees (20 variations each) |
| --- | --- |
| Forest, Flower Forest, Windswept Forest, rare in Plains | Oak (5 of them are old 2×2 oaks), plus fallen oak logs |
| Birch Forests | Birch, plus fallen birch logs |
| Taiga, Snowy Taiga, Grove | Layered Spruce (4 of them are 2×2 giants), plus fallen spruce logs |
| Old Growth Taiga | Redwood: 2×2 or 3×3 trunk, 28–38 blocks, root flares on podzol |
| Jungles | Jungle trees and 2×2 jungle giants covered in vines |
| Savannas | Acacia with 2–3 forked limbs and flat canopies |
| Dark Forest | 2×2 / 3×3 Dark Oak with a wide dome, plus fallen logs |
| Pale Garden | Pale Oak with hanging pale moss |
| Cherry Grove | Cherry with curved branches and hanging blossoms |
| Mangrove Swamp | Mangrove raised on arching prop roots |
| Swamp | Swamp Oak dripping with vines |
| Dappled Forest | Poplar in yellow, orange and red |

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
- No Man's Land clears about 41,000 blocks per chunk while generating, so
  chunks in that biome may load a little slower on low-end devices.
- Trees use a fixed orientation so vines stay attached; the 20 variations
  per species give the variety instead of rotation.
- If something does not generate, open **Settings → Creator → Content Log**
  to see the error.
