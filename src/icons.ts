// src/icons.ts
// SVG-Icons fuer Tasten (144x144): weisser fetter Text, mehrzeilig (\n),
// Schriftgroesse passt sich automatisch an die laengste Zeile an.
//
// WICHTIG: Der Stream-Deck-SVG-Renderer unterstuetzt kein <tspan>-Layout.
// Deshalb wird JEDE Zeile als eigenes <text>-Element gerendert (gleiche
// Technik wie im WLED-Plugin).
const KEY_SIZE = 144;
const PADDING = 8;

export function svgIcon(bgColor: string, text: string, textColor = "#ffffff", header = ""): string {
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

    const headerElem = header
        ? `<text x="10" y="24" text-anchor="start" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${escapeXml(header)}</text>`
        : "";

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="20" fill="${bgColor}"/>
  ${headerElem}
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
    offlineColor = "#808080",
    noDongleColor = "#5A1A1A",
    header = ""
): string | null {
    if (state.connected) return null;
    if (state.dongle_present === false) {
        return svgIcon(noDongleColor, "NO\nDONGLE", "#ffffff", header);
    }
    return svgIcon(offlineColor, "OFFLINE", "#ffffff", header);
}

// Batterie-Symbol im Stil des ATK-Plugins: Umriss + dynamische Fuellung
// nach Ladestand, Prozentzahl darunter, optionaler Header oben links.
export function batteryIcon(
    percent: number | null,
    color: string,
    bgColor = "#1A1A1A",
    header = "",
    labelOverride?: string,
): string {
    const pct = percent ?? 0;
    const fillWidth = Math.round(76 * (pct / 100));
    const label = labelOverride ?? (percent === null ? "--" : `${pct}%`);
    const headerElem = header
        ? `<text x="10" y="24" text-anchor="start" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${escapeXml(header)}</text>`
        : "";
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="20" fill="${bgColor}"/>
  ${headerElem}
  <rect x="28" y="40" width="86" height="40" rx="8" fill="none" stroke="${color}" stroke-width="5"/>
  <rect x="116" y="52" width="8" height="16" rx="3" fill="${color}"/>
  <rect x="33" y="45" width="${fillWidth}" height="30" rx="4" fill="${color}"/>
  <text x="72" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="bold" fill="${color}">${escapeXml(label)}</text>
</svg>`.trim();
    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}
