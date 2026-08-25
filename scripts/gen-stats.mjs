#!/usr/bin/env node
// Generates assets/stats.svg from the public GitHub API.
//
// Design rule: every animation here is decoration. If the renderer drops
// SMIL (GitHub serves README images through a proxy, and behaviour varies),
// each animated element must fall back to a base attribute value that still
// looks right. Nothing starts at opacity 0 or scaleX(0) waiting to be
// animated in — that is exactly how the third-party streak card ended up
// rendering as an empty box.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = process.env.STATS_USER || 'matheuspydev';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'stats.svg');

// A .ipynb file is JSON that embeds its own cell outputs, including
// base64 images, so GitHub attributes the whole file to "Jupyter Notebook".
// One notebook repo was drowning the bar at 69% while the Python actually
// written inside it never showed up at all. Excluded by default; override
// with STATS_EXCLUDE="" to count everything, or list your own languages.
const EXCLUDE = new Set(
  (process.env.STATS_EXCLUDE ?? 'Jupyter Notebook')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// Persona 3 palette: deep navy ground, blue ramp, lime accent.
const INK = '#050F2A';
const EDGE = '#1B3E9E';
const LABEL = '#8FB3FF';
const MUTED = '#5A79B5';
const LIME = '#D6E455';
const RAMP = ['#D6E455', '#7FA6FF', '#4C7BFF', '#2A55D8', '#1B3E9E', '#12306E'];

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': `${USER}-profile-stats`,
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function api(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function collect() {
  const repos = (await api(`https://api.github.com/users/${USER}/repos?per_page=100&type=owner`))
    .filter((r) => !r.fork && !r.archived);

  const bytes = new Map();
  for (const repo of repos) {
    let langs;
    try {
      langs = await api(repo.languages_url);
    } catch {
      continue; // one unreadable repo should not sink the whole card
    }
    for (const [lang, n] of Object.entries(langs)) {
      if (EXCLUDE.has(lang)) continue;
      bytes.set(lang, (bytes.get(lang) || 0) + n);
    }
  }

  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  let ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1]);

  // Keep the legend readable: top 5, everything else folded into "Other".
  if (ranked.length > 5) {
    const rest = ranked.slice(5).reduce((a, [, n]) => a + n, 0);
    ranked = ranked.slice(0, 5);
    if (rest > 0) ranked.push(['Other', rest]);
  }

  return {
    repoCount: repos.length,
    total,
    langs: ranked.map(([name, n], i) => ({
      name,
      pct: total ? (n / total) * 100 : 0,
      color: RAMP[i % RAMP.length],
    })),
  };
}

function render({ repoCount, total, langs }) {
  const W = 640;
  const H = 150;
  const BAR_X = 20;
  const BAR_Y = 48;
  const BAR_W = W - BAR_X * 2;
  const BAR_H = 14;

  // Stacked segments, drawn at full size. No entry animation.
  let cursor = BAR_X;
  const segments = langs
    .map((l) => {
      const w = Math.max((l.pct / 100) * BAR_W, l.pct > 0 ? 2 : 0);
      const rect = `<rect x="${cursor.toFixed(2)}" y="${BAR_Y}" width="${w.toFixed(2)}" height="${BAR_H}" fill="${l.color}"/>`;
      cursor += w;
      return rect;
    })
    .join('\n      ');

  // Legend: 3 columns, wraps to a second row.
  const COLS = 3;
  const COL_W = BAR_W / COLS;
  const legend = langs
    .map((l, i) => {
      const x = BAR_X + (i % COLS) * COL_W;
      const y = 92 + Math.floor(i / COLS) * 22;
      return (
        `<rect x="${x}" y="${y - 8}" width="9" height="9" rx="2" fill="${l.color}"/>` +
        `<text x="${x + 16}" y="${y}" font-size="12" fill="${LABEL}">${esc(l.name)}` +
        `<tspan fill="${MUTED}" dx="6">${l.pct.toFixed(1)}%</tspan></text>`
      );
    })
    .join('\n    ');

  const updated = new Date().toISOString().slice(0, 10);
  const kb = Math.round(total / 1024).toLocaleString('en-US');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Language mix across ${repoCount} public repositories">
  <title>Language mix — ${repoCount} public repositories</title>
  <defs>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity=".30"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="moonGlow">
      <stop offset="0%" stop-color="${LIME}" stop-opacity=".55"/>
      <stop offset="100%" stop-color="${LIME}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="barClip">
      <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="4"/>
    </clipPath>
  </defs>

  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="6" fill="${INK}" stroke="${EDGE}"/>
  <rect x="1" y="1" width="4" height="${H - 2}" fill="${LIME}" opacity=".85"/>

  <text x="${BAR_X}" y="30" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="12" letter-spacing="3" fill="${LABEL}">LANGUAGE MIX</text>
  <text x="${W - BAR_X - 18}" y="30" text-anchor="end" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="12" letter-spacing="1.5" fill="${MUTED}">${repoCount} PUBLIC REPOS</text>

  <!-- moon accent: pulses if SMIL runs, otherwise stays a static dot -->
  <circle cx="${W - 26}" cy="26" r="9" fill="url(#moonGlow)">
    <animate attributeName="r" values="8;12;8" dur="3.6s" repeatCount="indefinite"/>
  </circle>
  <circle cx="${W - 26}" cy="26" r="4" fill="${LIME}"/>

  <g font-family="'Segoe UI',Helvetica,Arial,sans-serif">
    <g clip-path="url(#barClip)">
      <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" fill="#0B1E4A"/>
      ${segments}
      <!-- highlight sweep: parked off-canvas, so no animation means no artefact -->
      <rect x="${-BAR_W}" y="${BAR_Y}" width="140" height="${BAR_H}" fill="url(#shine)">
        <animate attributeName="x" from="${BAR_X - 140}" to="${BAR_X + BAR_W}" dur="2.8s" begin="0s" repeatCount="indefinite"/>
      </rect>
    </g>

    ${legend}

    <text x="${BAR_X}" y="${H - 12}" font-size="10" letter-spacing="1" fill="${MUTED}">${kb} KB OF CODE · UPDATED ${updated}</text>
  </g>
</svg>
`;
}

const data = await collect();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, render(data), 'utf8');
console.log(`wrote ${OUT} — ${data.repoCount} repos, ${data.langs.length} languages`);
