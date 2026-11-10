import { describe, expect, it } from "vitest";
import { fragment, initSegment, MP4_TIMESCALE } from "./mp4";

type Box = { type: string; start: number; size: number; body: Buffer };

// Where each box's children start in its body: after a full box's header
// and entry count, or a sample entry's fields
const CHILDREN: Record<string, number> = {
  moov: 0,
  trak: 0,
  mdia: 0,
  minf: 0,
  dinf: 0,
  stbl: 0,
  mvex: 0,
  moof: 0,
  traf: 0,
  dref: 8,
  stsd: 8,
  avc1: 78,
};

// Each box at the top level of bytes, checking the sizes add up
const boxes = (bytes: Buffer, base = 0): Box[] => {
  const found: Box[] = [];
  let at = 0;
  while (at < bytes.length) {
    const size = bytes.readUInt32BE(at);
    expect(size).toBeGreaterThanOrEqual(8);
    expect(at + size).toBeLessThanOrEqual(bytes.length);
    const type = bytes.toString("latin1", at + 4, at + 8);
    found.push({
      type,
      start: base + at,
      size,
      body: bytes.subarray(at + 8, at + size),
    });
    at += size;
  }
  expect(at).toBe(bytes.length);
  return found;
};

// The box tree as types, children in arrays after their parent's type
type Tree = (string | Tree)[];
const tree = (bytes: Buffer): Tree =>
  boxes(bytes).flatMap(({ type, body }) =>
    type in CHILDREN ? [type, tree(body.subarray(CHILDREN[type]))] : [type],
  );

// The box at a path of types, like ["moov", "trak", "tkhd"]
const find = (bytes: Buffer, path: string[], base = 0): Box => {
  const [type, ...rest] = path;
  const found = boxes(bytes, base).find((b) => b.type === type);
  expect(found, type).toBeDefined();
  if (rest.length === 0) return found!;
  const skip = CHILDREN[type];
  return find(found!.body.subarray(skip), rest, found!.start + 8 + skip);
};

// An AVCDecoderConfigurationRecord's start: version, profile, compatibility,
// level, then one SPS and one PPS
const DESCRIPTION = new Uint8Array([
  1, 0x42, 0xc0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1f, 1, 0, 2, 0x68,
  0xce,
]);
const CONFIG = {
  codec: "avc1.42c01f",
  width: 1280,
  height: 720,
  description: DESCRIPTION,
};

describe("initSegment", () => {
  const init = initSegment(CONFIG);

  it("holds an ftyp, then a moov with one video track", () => {
    expect(tree(init)).toEqual([
      "ftyp",
      "moov",
      [
        "mvhd",
        "trak",
        [
          "tkhd",
          "mdia",
          [
            "mdhd",
            "hdlr",
            "minf",
            [
              "vmhd",
              "dinf",
              ["dref", ["url "]],
              "stbl",
              ["stsd", ["avc1", ["avcC"]], "stts", "stsc", "stsz", "stco"],
            ],
          ],
        ],
        "mvex",
        ["trex"],
      ],
    ]);
  });

  it("names its brands", () => {
    const { body } = find(init, ["ftyp"]);
    expect(body.toString("latin1", 0, 4)).toBe("isom");
    expect(body.readUInt32BE(4)).toBe(0x200);
    expect(body.toString("latin1", 8)).toBe("isomiso5iso6avc1mp41");
  });

  it("sizes the boxes as the spec lays them out", () => {
    const sizes = Object.fromEntries(
      [
        ["moov", "mvhd"],
        ["moov", "trak", "tkhd"],
        ["moov", "trak", "mdia", "mdhd"],
        ["moov", "trak", "mdia", "minf", "vmhd"],
        ["moov", "trak", "mdia", "minf", "dinf", "dref", "url "],
        ["moov", "mvex", "trex"],
      ].map((path) => [path.at(-1), find(init, path).size]),
    );
    expect(sizes).toEqual({
      mvhd: 108,
      tkhd: 92,
      mdhd: 32,
      vmhd: 20,
      "url ": 12,
      trex: 32,
    });
  });

  it("sets the clocks, the track and its size", () => {
    const mvhd = find(init, ["moov", "mvhd"]).body;
    expect(mvhd.readUInt32BE(12)).toBe(1000);
    expect(mvhd.readUInt32BE(16)).toBe(0);
    expect(mvhd.readUInt32BE(96)).toBe(2);

    const tkhd = find(init, ["moov", "trak", "tkhd"]).body;
    expect(tkhd.readUInt32BE(0)).toBe(3);
    expect(tkhd.readUInt32BE(12)).toBe(1);
    expect(tkhd.readUInt32BE(76)).toBe(1280 << 16);
    expect(tkhd.readUInt32BE(80)).toBe(720 << 16);

    const mdhd = find(init, ["moov", "trak", "mdia", "mdhd"]).body;
    expect(mdhd.readUInt32BE(12)).toBe(MP4_TIMESCALE);
    const lang = mdhd.readUInt16BE(20);
    expect(
      String.fromCharCode(
        ((lang >> 10) & 31) + 0x60,
        ((lang >> 5) & 31) + 0x60,
        (lang & 31) + 0x60,
      ),
    ).toBe("und");

    const hdlr = find(init, ["moov", "trak", "mdia", "hdlr"]).body;
    expect(hdlr.toString("latin1", 8, 12)).toBe("vide");

    const trex = find(init, ["moov", "mvex", "trex"]).body;
    expect([trex.readUInt32BE(4), trex.readUInt32BE(8)]).toEqual([1, 1]);
  });

  it("describes the video in one avc1 entry, with the avcC verbatim", () => {
    const stbl = ["moov", "trak", "mdia", "minf", "stbl"];
    expect(find(init, [...stbl, "stsd"]).body.readUInt32BE(4)).toBe(1);
    const avc1 = find(init, [...stbl, "stsd", "avc1"]).body;
    expect(avc1.readUInt16BE(6)).toBe(1);
    expect([avc1.readUInt16BE(24), avc1.readUInt16BE(26)]).toEqual([1280, 720]);
    expect([avc1.readUInt32BE(28), avc1.readUInt32BE(32)]).toEqual([
      0x480000, 0x480000,
    ]);
    expect(avc1.readUInt16BE(40)).toBe(1);
    expect(avc1.readUInt16BE(74)).toBe(0x18);
    expect(avc1.readInt16BE(76)).toBe(-1);

    const avcC = find(init, [...stbl, "stsd", "avc1", "avcC"]);
    expect(avcC.size).toBe(8 + DESCRIPTION.length);
    expect(new Uint8Array(avcC.body)).toEqual(DESCRIPTION);
  });

  it("leaves the sample tables empty", () => {
    const stbl = ["moov", "trak", "mdia", "minf", "stbl"];
    for (const type of ["stts", "stsc", "stco"]) {
      expect(find(init, [...stbl, type]).size).toBe(16);
    }
    expect(find(init, [...stbl, "stsz"]).size).toBe(20);
  });
});

describe("fragment", () => {
  const data = Buffer.from([0, 0, 0, 3, 0x65, 0x88, 0x84]);

  it("holds a moof for one sample, then an mdat with its bytes", () => {
    const bytes = fragment(7, 2 ** 33 + 5, 3000, true, data);

    expect(tree(bytes)).toEqual([
      "moof",
      ["mfhd", "traf", ["tfhd", "tfdt", "trun"]],
      "mdat",
    ]);
    expect(find(bytes, ["moof", "mfhd"]).body.readUInt32BE(4)).toBe(7);
    const tfhd = find(bytes, ["moof", "traf", "tfhd"]).body;
    expect([tfhd.readUInt32BE(0), tfhd.readUInt32BE(4)]).toEqual([0x020000, 1]);
    const tfdt = find(bytes, ["moof", "traf", "tfdt"]).body;
    expect(tfdt[0]).toBe(1);
    expect(tfdt.readBigUInt64BE(4)).toBe(2n ** 33n + 5n);

    const trun = find(bytes, ["moof", "traf", "trun"]).body;
    expect(trun.readUInt32BE(0)).toBe(0x000701);
    expect(trun.readUInt32BE(4)).toBe(1);
    expect(trun.readUInt32BE(12)).toBe(3000);
    expect(trun.readUInt32BE(16)).toBe(data.length);
    expect(trun.readUInt32BE(20)).toBe(0x02000000);

    // The data offset, from the moof's start, lands on the mdat's payload
    const offset = trun.readInt32BE(8);
    expect(offset).toBe(find(bytes, ["moof"]).size + 8);
    expect(bytes.subarray(offset)).toEqual(data);
  });

  it("flags a delta as depending on others, not a sync sample", () => {
    const trun = find(fragment(1, 0, 3000, false, data), [
      "moof",
      "traf",
      "trun",
    ]).body;
    expect(trun.readUInt32BE(20)).toBe(0x01010000);
  });
});
