---
title: Block compatibility smoke doc
---

# Editor blocks I — external-renderer smoke doc

This file exercises every block type added in Phase C1 (FR21-BLK-001..004) with
the exact portable syntax Mica reads and writes. It is checked into the repo so
external renderers (Obsidian, GitHub, VS Code preview) can be spot-checked for
graceful rendering. Mica's own round-trip must reproduce every block here
byte-for-byte.

## Callouts (FR21-BLK-001)

> [!note] A plain note
> Notes use the muted accent.

> [!info] Optional title
> Body continues as normal blockquote lines.
> Second body line.

> [!tip] Pro tip
> Tips render with the success accent.

> [!warning]
> A titleless warning callout.

> [!danger] Danger
> Something risky.

> [!quote] Marcus Aurelius
> You have power over your mind — not outside events.

> [!custom] Unknown kind
> Renders as a note but re-serializes `custom` verbatim.

## Toggle lists (FR21-BLK-002)

<details><summary>Click to expand</summary>

Toggle bodies hold **any** markdown, including nested blocks:

- a list item
- another item

</details>

## Tables (FR21-BLK-003)

| Name  | Role      | Count |
| --- | --- | --- |
| Alpha | Producer  | 1 |
| Beta  | Consumer  | 2 |
| Gamma | Scheduler | 3 |

## Math (FR21-BLK-004)

A block equation:

$$
E = mc^2
$$

A multi-line block equation:

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

Inline math like $a^2 + b^2 = c^2$ sits in a sentence, and prices such as
$5 and $10 are left untouched as plain text.
