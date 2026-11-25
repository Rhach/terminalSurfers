# Showdown

Endless little contests between coloured dots, right in your terminal. Something to keep in the corner of your eye: there's always a stake, always something happening, and a winner every minute or so.

```
node showdown.js
```

No dependencies. Needs Node.js 16+ on Windows, macOS or Linux, and adapts to any terminal size (including resizes).

## Rounds

Rounds rotate forever, with a running win tally across them.

- **Race**: five laps of a freshly generated circuit, seen from a chase camera behind one racer. The track widens and pinches into bottlenecks and splits round dividers. Bumpers, spinning bars, sliding gates and boulders get in the way, and racers grab pickups to zap, shockwave, mine or shield against each other. The last-placed racers are knocked out each lap until two are left for a final duel.
- **Escape**: balls bounce inside spinning rings. Slip through a gap and the ring shatters; whoever breaks the last one wins.
- **Color War**: each colour's balls paint the enemy territory they bounce off. Power-ups split, bomb and boost. The last colour on the board wins.
- **Hunt**: blobs swallow grey drifters to grow, and contact between rivals costs both of them. Golden orbs spark scrambles, and a closing zone forces the endgame.

## Graphics

Where the terminal can show real pixels, Showdown draws smooth, anti-aliased graphics through a terminal image protocol, picked automatically:

| Protocol | Terminals |
| --- | --- |
| Sixel | Windows Terminal 1.22+, foot, Konsole, mlterm, xterm (`-ti vt340`) |
| Kitty | kitty, Ghostty |
| iTerm2 | iTerm2, WezTerm |

Elsewhere (for example macOS Terminal.app, or inside tmux) it falls back to anti-aliased half-block characters.

## Options

```
--round <name>     only play one kind of round: race, escape, war, hunt
--gfx <mode>       auto | sixel | kitty | iterm | text   (default auto)
--fps <n>          target frame rate (default 30; try 20 if it stutters)
--colors <mode>    text mode colours: auto | truecolor | 256
```

Keys: <kbd>Space</kbd> / <kbd>N</kbd> next round, <kbd>P</kbd> pause, <kbd>Q</kbd> / <kbd>Esc</kbd> quit.

## License

[MIT](LICENSE) © 2026 Tasos Chronis. You're free to use, change and share it; just keep the copyright notice.
