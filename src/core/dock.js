// Rechnen für das Dock: die Reihe der Ansichten hat kein Ende (fünf Symbole, gewischt, nichts zum Anstoßen),
// jedes Symbol wird an seiner nächsten Runde gezeichnet. Ohne DOM, damit es sich prüfen lässt.
export const nearestTurn = (d, n) => ((d % n) + n * 1.5) % n - n / 2;

/* Wo die Reihe nach dem Loslassen landet: der nächste Platz, nach einem Schnipp 160 ms weiter in Wischrichtung */
export const settleTarget = (pos, velocity, slotsPerPx, dir) => Math.round(pos - velocity * dir * 160 * slotsPerPx);

export const glideDuration = distance => Math.min(520, 200 + Math.abs(distance) * 120);
