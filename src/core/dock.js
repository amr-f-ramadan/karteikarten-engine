// Rechnen für das Dock: die Reihe der Ansichten hat kein Ende (fünf Symbole, gewischt, nichts zum Anstoßen),
// jedes Symbol wird an seiner nächsten Runde gezeichnet. Ohne DOM, damit es sich prüfen lässt.
export const nearestTurn = (d, n) => ((d % n) + n * 1.5) % n - n / 2;

/* Wo die Reihe nach dem Loslassen landet: der nächste Platz, nach einem Schnipp 160 ms weiter in Wischrichtung,
   höchstens zwei Plätze (ein einzelner Sprung der Zeigerposition darf die Reihe nicht durchdrehen lassen) */
export const settleTarget = (pos, velocity, slotsPerPx, dir) => Math.round(pos + Math.max(-2, Math.min(2, -velocity * dir * 160 * slotsPerPx)));

export const glideDuration = distance => Math.min(520, 200 + Math.abs(distance) * 120);
