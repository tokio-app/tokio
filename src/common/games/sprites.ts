import { AlertTrigger, TOKIO_EVENTS } from "../types/connector";

// Tokio's own pixel art for the events without a picture of their own, drawn
// like the game's sprites: a black outline, a fill and a shade.
const COLORS: Record<string, string> = {
  k: "#000000",
  w: "#f1f5f9",
  s: "#94a3b8",
  r: "#f43f5e",
  d: "#be123c",
  l: "#fecdd3",
  y: "#facc15",
  o: "#b45309",
  h: "#fef9c3",
};

const HEART = [
  ".............",
  "..kkk...kkk..",
  ".krrrk.krrrk.",
  "krllrrkrrrrdk",
  "krlrrrrrrrrdk",
  "krrrrrrrrrrdk",
  ".krrrrrrrrdk.",
  "..krrrrrrdk..",
  "...krrrrdk...",
  "....krrdk....",
  ".....kdk.....",
  "......k......",
  ".............",
];

// A viewer with TikTok's plus
const FOLLOW = [
  "....kkk......",
  "...kwwwk.....",
  "..kwwwwsk....",
  "..kwwwwsk....",
  "...kwwsk.....",
  "....kkkkkkk..",
  "..kkwwwkrrk..",
  ".kwwwwwkrrkkk",
  "kwwwwkrrrrrrk",
  "kwwwwkrrrrddk",
  "kwwwwkkkrdkkk",
  "kkkkkkkkrdk..",
  ".......kkkk..",
];

const SHARE = [
  ".......k.....",
  ".......kk....",
  ".......kwk...",
  ".......kwwk..",
  "...kkkkkwwwk.",
  "..kwwwwwwwwwk",
  ".kwwwwwwwwwsk",
  ".kwwwwwwwwsk.",
  "kwwkkkkkwssk.",
  "kwk....kssk..",
  "kwk....ksk...",
  "kk.....kk....",
  ".......k.....",
];

const CHAT = [
  ".............",
  ".kkkkkkkkkkk.",
  "kwwwwwwwwwwwk",
  "kwwwwwwwwwwsk",
  "kwkkwkkwkkwsk",
  "kwkkwkkwkkwsk",
  "kwwwwwwwwwwsk",
  "kwwwwwwwwwssk",
  ".kkkwwkkkkkk.",
  "...kwk.......",
  "...kk........",
  "...k.........",
  ".............",
];

// A paid membership, with Tokio's rose for gems
const SUPER_FAN = [
  ".............",
  ".............",
  ".k....k....k.",
  "khk..khk..khk",
  "kyk..kyk..kyk",
  "kyyk.kyk.kyok",
  "kyyykyyykyyok",
  "kyyyyyyyyyyok",
  "kyyryyyyryyok",
  "kyyyyyyyyyook",
  "kkkkkkkkkkkkk",
  ".............",
  ".............",
];

// An SVG picture, one path per color with a rectangle per run of pixels.
// crispEdges keeps them square at any size.
function sprite(rows: string[]) {
  const paths: Record<string, string> = {};
  rows.forEach((row, y) => {
    for (let x = 0, end = 0; x < row.length; x = end) {
      while (row[end] === row[x]) end++;
      if (row[x] !== ".") {
        paths[row[x]] = `${paths[row[x]] ?? ""}M${x} ${y}h${end - x}v1H${x}z`;
      }
    }
  });
  const body = Object.entries(paths)
    .map(([c, d]) => `<path fill="${COLORS[c]}" d="${d}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The pictures of the events TikTok has none for, as data: URLs */
export const EVENT_SPRITES: Partial<Record<AlertTrigger, string>> = {
  [TOKIO_EVENTS.LIKE]: sprite(HEART),
  [TOKIO_EVENTS.FOLLOW]: sprite(FOLLOW),
  [TOKIO_EVENTS.SHARE]: sprite(SHARE),
  [TOKIO_EVENTS.CHAT]: sprite(CHAT),
  [TOKIO_EVENTS.SUPER_FAN]: sprite(SUPER_FAN),
};
