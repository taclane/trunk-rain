# Changelog

## [0.2.0]

- Rain on a grid, one glyph a cell: falling frames write their glyphs into the cells they pass,
  so streaks crossing a column no longer draw over each other.
- Brightness falls linearly behind each head, through a palette from dark to pale, and the dimmer
  part of a trail is dark, as in classic digital rain.
- Lit glyphs change now and then while they fade: to the same place in the talker's newest frame
  (`change`: `data`), to any glyph (`random`), or not at all; `changeRate` sets how often.
- Frames a streak (`stack`, 1–4, default 2): a talker's frames end to end, for longer streaks.
  Each glyph keeps its own frame's colour, so a damaged frame is still red.
- Trail length (`trail`) is an option of its own, so longer streaks don't fill the screen.
- The control channel on a layer of its own behind the voice (`cc`: every message, grants/updates/units
  only, or off; `ccLevel` its brightness, background noise by default): each message's numbers fall as
  glyphs, from the `log` topic. A lit voice glyph covers what's behind it.

## [0.1.0]

- First release. Needs a Trunk Recorder Pro whose interface API sends vocoder frames (`listen` with
  `voice: true`), newer than 0.3.6.
