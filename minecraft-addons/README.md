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
No tree uses the stepped, pyramid-shaped canopies (vanilla `canopy`,
`mega_canopy` or `mega_pine_canopy`). Crowns are made of rounded leaf
clusters at the end of each branch plus a rounded or fluffy top crown.
Spruces are rebuilt as **tiered conifers**: whorls of short branches up the
trunk, each with its own leaf cluster.

## BREATHE OF THE WILD

### Mystic Forest (`botw:mystic_forest`)
Replaces part of the Forest and Flower Forest biomes. Its trees are all oak:

- **Great Oak**: 2×2 trunk, 18–28 blocks tall, side branches that each carry
  their own canopy, a wide crown and vines on the trunk.
- **Elder Oak**: huge 2×2 "fancy" oak with many branches and leaf clusters.
- **Crooked Oak**: a leaning oak with an extra branch and canopy.
- Oak bushes, fallen oak logs with shelf mushrooms, ferns, moss, leaf
  litter, firefly bushes, mushrooms and lily of the valley.
- Podzol and moss patches, deep green grass, and a misty teal fog.

### Mighty Birch Forest (`botw:mighty_birch_forest`)
Replaces part of the Birch Forest and Old Growth Birch Forest biomes.

- **Mighty Birch**: a birch with a 20–22 block trunk (vanilla birch trunks
  are 5–7, so 15 blocks taller) and side branches with their own canopies.
- **Fancy Mighty Birch**: same height, with more open branching.
- **Ancient Birch** (rare): 2×2 trunk, 24–29 blocks, branches with canopies.
- Fallen birch logs, wildflowers, lily of the valley and dandelions.

### No Man's Land (`botw:no_mans_land`)
Replaces part of the Savanna and Desert biomes with an enormous open pit.

- Every block in the biome is removed from **Y 127 down to Y −32**, so the
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

Adds a bigger version of every vanilla tree type to the biomes where it
grows. The big trees are placed before vanilla trees, so they take the best
spots and vanilla trees fill the gaps.

| Biome | New trees |
| --- | --- |
| Forest, Flower Forest, Windswept Forest | Grand Oak, Branching Oak (branches with canopies), Old 2×2 Oak, fallen oak logs |
| Plains | Rare lone Grand/Old Oaks |
| Birch Forests | Tall Branching Birch, Grand Birch, fallen birch logs |
| Taiga, Snowy Taiga, Grove | Towering tiered Spruce, Giant 2×2 tiered Spruce, fallen spruce logs |
| Old Growth Taiga | Ancient Redwood: 2×2 tiered trunk, 26–39 blocks, podzol base |
| Jungles | Jungle Giant (vines, canopied branches), tall Jungle Canopy Tree |
| Savannas | Grand Acacia (double canopy), Umbrella Acacia |
| Dark Forest | Ancient Dark Oak with roofed side canopies, fallen logs |
| Pale Garden | Ancient Pale Oak |
| Cherry Grove | Grand Cherry with two or three branches |
| Mangrove Swamp | Grand Mangrove with bigger roots and hanging propagules |
| Swamp | Old Swamp Oak covered in vines |
| Dappled Forest | Grand Poplars (yellow, orange and red) |

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
- If something does not generate, open **Settings → Creator → Content Log**
  to see the error.
