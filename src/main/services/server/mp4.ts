import type { CameraConfig } from "@/common/types";

// Fragmented MP4 (ISO/IEC 14496-12) for a camera's H.264, which pages play
// through MediaSource: one init segment, then one fragment per chunk.

// The fragments' clock: 90 kHz, as H.264 in MP4 usually has
export const MP4_TIMESCALE = 90_000;

const u16 = (...values: number[]) => {
  const buf = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => buf.writeUInt16BE(v, i * 2));
  return buf;
};
const u32 = (...values: number[]) => {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeUInt32BE(v, i * 4));
  return buf;
};
const zeros = (size: number) => Buffer.alloc(size);
const text = (value: string) => Buffer.from(value, "latin1");

const box = (type: string, ...parts: Uint8Array[]) => {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 8);
  return Buffer.concat([u32(size), text(type), ...parts]);
};
const fullBox = (
  type: string,
  version: number,
  flags: number,
  ...parts: Uint8Array[]
) => box(type, u32(((version << 24) | flags) >>> 0), ...parts);

// The identity matrix, in 16.16 and 2.30
const MATRIX = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
// "und", three 5-bit letters, each less 0x60
const UND = (21 << 10) | (14 << 5) | 4;

// The code points (ISO/IEC 23091-2) of the colors WebCodecs names; 2 is
// unspecified
const PRIMARIES: Record<string, number> = {
  bt709: 1,
  bt470bg: 5,
  smpte170m: 6,
  bt2020: 9,
  smpte432: 12,
};
const TRANSFERS: Record<string, number> = {
  bt709: 1,
  smpte170m: 6,
  linear: 8,
  "iec61966-2-1": 13,
  pq: 16,
  hlg: 18,
};
const MATRICES: Record<string, number> = {
  rgb: 0,
  bt709: 1,
  bt470bg: 5,
  smpte170m: 6,
  "bt2020-ncl": 9,
};
const UNSPECIFIED = 2;

const codeOf = (codes: Record<string, number>, name: string | null) =>
  (name !== null && Object.hasOwn(codes, name) && codes[name]) || UNSPECIFIED;

/**
 * The frames' colors (colr, nclx), which the encoder's H.264 doesn't carry:
 * without them Chromium takes HD video for BT.709, and a camera's BT.601
 * greens come out darker. None when nothing is known.
 */
function colr(colors: CameraConfig["colors"]) {
  if (!colors) return [];
  const codes = [
    codeOf(PRIMARIES, colors.primaries),
    codeOf(TRANSFERS, colors.transfer),
    codeOf(MATRICES, colors.matrix),
  ];
  if (codes.every((code) => code === UNSPECIFIED)) return [];
  return [
    box(
      "colr",
      text("nclx"),
      u16(...codes),
      Buffer.from([colors.fullRange ? 0x80 : 0]),
    ),
  ];
}

/** The init segment: ftyp and moov, for a track of the config's video. */
export function initSegment({
  width,
  height,
  description,
  colors,
}: CameraConfig) {
  const ftyp = box(
    "ftyp",
    text("isom"),
    u32(0x200),
    text("isomiso5iso6avc1mp41"),
  );
  const mvhd = fullBox(
    "mvhd",
    0,
    0,
    // Creation and modification times, timescale, duration
    u32(0, 0, 1000, 0),
    // Rate 1.0, volume 1.0, reserved
    u32(0x10000),
    u16(0x100),
    zeros(10),
    MATRIX,
    // pre_defined
    zeros(24),
    // next_track_ID
    u32(2),
  );
  const tkhd = fullBox(
    "tkhd",
    0,
    // Enabled and in the movie
    3,
    // Creation and modification times, track_ID, reserved, duration
    u32(0, 0, 1, 0, 0),
    zeros(8),
    // Layer, alternate group, volume, reserved
    u16(0, 0, 0, 0),
    MATRIX,
    u32(width * 0x10000, height * 0x10000),
  );
  const mdhd = fullBox("mdhd", 0, 0, u32(0, 0, MP4_TIMESCALE, 0), u16(UND, 0));
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    u32(0),
    text("vide"),
    zeros(12),
    text("VideoHandler\0"),
  );
  const avc1 = box(
    "avc1",
    // Reserved, data_reference_index
    zeros(6),
    u16(1),
    // pre_defined and reserved
    zeros(16),
    u16(width, height),
    // 72 dpi each way, reserved, frame count
    u32(0x480000, 0x480000, 0),
    u16(1),
    // compressorname
    zeros(32),
    // Depth, pre_defined -1
    u16(0x18, 0xffff),
    box("avcC", description),
    ...colr(colors),
  );
  const stbl = box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), avc1),
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0, 0)),
    fullBox("stco", 0, 0, u32(0)),
  );
  const minf = box(
    "minf",
    fullBox("vmhd", 0, 1, zeros(8)),
    box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
    stbl,
  );
  const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, minf));
  // Track 1, sample description 1, no default duration, size or flags
  const mvex = box("mvex", fullBox("trex", 0, 0, u32(1, 1, 0, 0, 0)));
  return Buffer.concat([ftyp, box("moov", mvhd, trak, mvex)]);
}

/**
 * One sample's fragment: moof, then mdat with the chunk's bytes (4-byte
 * length-prefixed NAL units, as an MP4 sample holds them).
 */
export function fragment(
  sequence: number,
  decodeTime: number,
  duration: number,
  key: boolean,
  data: Uint8Array,
) {
  const tfdt = Buffer.alloc(8);
  tfdt.writeBigUInt64BE(BigInt(Math.round(decodeTime)));
  // A keyframe depends on no other sample; a delta does, and isn't a sync
  // sample
  const flags = key ? 0x02000000 : 0x01010000;
  const moof = (offset: number) =>
    box(
      "moof",
      fullBox("mfhd", 0, 0, u32(sequence)),
      box(
        "traf",
        // default-base-is-moof
        fullBox("tfhd", 0, 0x020000, u32(1)),
        fullBox("tfdt", 1, 0, tfdt),
        // data-offset, then each sample's duration, size and flags
        fullBox(
          "trun",
          0,
          0x000701,
          u32(1, offset, duration, data.byteLength, flags),
        ),
      ),
    );
  // The data offset counts from the moof's start to the mdat's payload
  const size = moof(0).byteLength;
  return Buffer.concat([moof(size + 8), box("mdat", data)]);
}
