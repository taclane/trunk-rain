# Vocoder Rain

A Trunk Recorder Pro interface that shows live digital voice as falling vocoder frames: each
20 ms IMBE or AMBE+2 frame falls as one streak of its own information bits, in hex (or kana,
or bits). The head of a streak is bright, the trail fades. Damaged frames (repeated, muted,
lost) fall in red. Glyphs flicker as many times as the FEC corrected errors. Tags on the
heads name the talkgroup and the radio talking.

It's a novelty. It needs a recorder whose API has vocoder frames (`listen` with
`voice: true`).

## Use

Add the `interface/` folder on the Interfaces page (**Add a folder…**), or run
`trunk-pro interface add interface/`, and open it. The ⚙ button has the options. Any option
also works in the address, for a wall display: `?color=tg&glyphs=kana&size=20&tags=tg`.

`?demo` runs it on made-up frames without a recorder. Add `&warm=4` to start with 4 seconds
of rain already fallen.

| Option | Values |
|---|---|
| `tags` | `both`, `tg`, `unit`, `off` |
| `tagEvery` | `sec`, `tx` (each transmission), `drop` (each frame) |
| `color` | `classic`, `tg`, `unit`, `codec` |
| `glyphs` | `hex`, `kana`, `bits` |
| `speed` | rows a second, 4–60 |
| `size` | glyph size, px |
| `bad`, `flicker`, `sound` | `1` / `0` |
| `tgFilter` | a talkgroup number (filtered at the recorder) or text to match its alpha tag |
