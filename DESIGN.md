# rapelaunch

A separate, English-language Raydium launcher. The main job is to coordinate a developer wallet and up to six first-block buyers, with a visible funding budget and honest migration status.

Palette: ink #17284D, canvas #F3F5FC, paper #FFFFFF, cobalt #355CFA, lavender #E7E3FF, muted #71809D. Bricolage Grotesque 800 for the large, tightly spaced headings; Manrope 500–800 for controls and readable financial data. Fonts are bundled locally.

Layout: left-aligned app navigation; generous launch workspace with token form and ordered wallet roster; a compact, dark execution summary on the right. Wallets and activity are separate views rather than more settings on the launch form.

```
Navigation | Launch headline             | Network / vault
           | Token identity              | Launch preview
           | Migration target            | Funding breakdown
           | Dev + ordered buyer roster  | Review launch
```

The visual emphasis is typography and the ordered wallet roster, not decorative charts. Controls use sentence case, visible focus states, mobile reflow and reduced-motion support. A submitted bundle is distinct from an on-chain migrated pool. Zero block describes the requested same-slot bundle; it does not guarantee inclusion, exclusivity or a terminal badge.
