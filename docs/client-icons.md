# Client icon artwork

The dashboard uses local SVG paths to identify configured clients. No remote image requests or runtime icon downloads are made. The original silhouettes use `currentColor` inside matching tinted badges in light and dark mode.

- Codex: [Lobe Icons Codex asset](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/codex.svg).
- Claude Code: [Lobe Icons Claude Code asset](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/claudecode.svg), the product's pixel mascot.
- Antigravity: [Google's official press assets](https://antigravity.google/press), one-color icon ([SVG](https://antigravity.google/assets/image/brand/antigravity-icon__one-color.svg)).
- Generic client: Lucide Monitor, using the same badge treatment.

Product names and marks belong to their respective owners and identify the client only. Codex and Claude Code paths are distributed by Lobe Icons under the MIT license, reproduced in [the icon license](licenses/lobe-icons-MIT.txt). Color follows the gateway theme; geometry is unchanged.

Additional product marks: OpenClaw, Cursor, Windsurf and GitHub Copilot use the corresponding SVGs from [Lobe Icons](https://github.com/lobehub/lobe-icons/tree/master/packages/static-svg/icons), under the bundled Lobe Icons MIT license. Claude Desktop uses the [Simple Icons Claude mark](https://github.com/simple-icons/simple-icons/blob/develop/icons/claude.svg), distributed under CC0. Hermes uses the silhouette from [Nous Research's official icon](https://github.com/NousResearch/hermes-agent/blob/main/assets/icon-master.svg), with its source view box and transform preserved and fill following the theme; see [Hermes MIT license](licenses/hermes-agent-MIT.txt). All marks are bundled locally, with no user-supplied asset URLs or runtime downloads.
