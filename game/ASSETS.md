# Third-party assets and notices

## Ninja Adventure Asset Pack

The player character in this project is generated from the **Ninja Adventure
Asset Pack** by **Pixel-Boy** and **AAA**.

- Repository: https://github.com/pixel-boy/NinjaAdventure
- Source page: https://pixel-boy.itch.io/ninja-adventure-asset-pack
- License: **Creative Commons Zero v1.0 Universal (CC0 1.0)** — public domain.
  Commercial use allowed. Attribution is not required, but is given here
  because it is deserved.

Source sprite: `content/character/ninja_blue/sprite.png` (64x112, 16x16 frames,
4 columns = directions, 7 rows = animations).

The copy kept in `game/ref/ninja-blue.png` is the unmodified source file.
`game/entities/ninjaFrames.js` is derived from it by
`game/tools/build-ninja-frames.mjs`, which:

1. extracts the left/right direction columns,
2. remaps the blue/teal outfit colours to a neutral dark palette
   (so the character reads as a figure in black),
3. keeps the white face mask, skin tones and red sash untouched,
4. emits compact indexed pixel data.

No generative AI was used in the creation of the source assets.

## pixelfx

Visual effects come from **pixelfx** by Patch (MIT).

- Repository: https://github.com/patch-gg/pixelfx
- Parts of pixelfx are adapted from Hugo Duprez's MIT effects and from
  Hollow Crown's MIT source.
- See the root `LICENSE` for the full notice.

pixelfx is cloned at runtime and is not vendored into this repository.

## Patch Pixel font

The Patch Pixel font inside pixelfx's gallery is Patch's own and is **not**
covered by the MIT license. This project does not ship or use that font; it
only uses pixelfx's built-in 3x5 / 5x7 bitmap fonts.
