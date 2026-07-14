// src/icons.ts
// SVG-Icons fuer Tasten (144x144): weisser fetter Text, mehrzeilig (\n),
// Schriftgroesse passt sich automatisch an die laengste Zeile an.
//
// WICHTIG: Der Stream-Deck-SVG-Renderer unterstuetzt kein <tspan>-Layout.
// Deshalb wird JEDE Zeile als eigenes <text>-Element gerendert (gleiche
// Technik wie im WLED-Plugin).
const KEY_SIZE = 144;
const PADDING = 8;

export function svgIcon(bgColor: string, text: string, textColor = "#ffffff"): string {
    const lines = text.split("\n");
    const maxLen = Math.max(...lines.map((l) => l.length), 1);

    // Arial Bold: Zeichenbreite ~0.62 * fontSize
    const usable = KEY_SIZE - 2 * PADDING;
    let fs = Math.floor(usable / (0.62 * maxLen));
    fs = Math.min(30, Math.max(12, fs));

    const lineHeight = Math.round(fs * 1.2);
    const totalHeight = lineHeight * lines.length;
    const firstY = Math.round(KEY_SIZE / 2 - totalHeight / 2 + fs * 0.85);

    const textElems = lines
        .map((l, i) =>
            `<text x="72" y="${firstY + i * lineHeight}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fs}" font-weight="bold" fill="${textColor}">${escapeXml(l)}</text>`
        )
        .join("\n  ");

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="20" fill="${bgColor}"/>
  ${textElems}
</svg>`.trim();
    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// "Nicht verbunden"-Icon mit konfigurierbaren Farben, oder null wenn verbunden.
export function disconnectedIcon(
    state: any,
    offlineColor = "#3D3D3D",
    noDongleColor = "#5A1A1A"
): string | null {
    if (state.connected) return null;
    if (state.dongle_present === false) {
        return svgIcon(noDongleColor, "NO\nDONGLE");
    }
    return svgIcon(offlineColor, "OFFLINE");
}