// Retakes the README's screenshots into .github/screenshots/, and the
// website's docs screenshots into ../tokio-web/src/assets/screenshots/ when
// that repo is there. A steps file for drive.mjs, see ../SKILL.md:
//
//   node .claude/skills/drive-app/scripts/drive.mjs --scale 2 .claude/skills/drive-app/scripts/screenshots.mjs
//
// The README's are 1200x800 whatever the scale; the docs' are crops of what
// each section describes, at the device scale, so --scale 2 keeps them sharp.
// It installs official overlays, so it needs the network, and takes its gifts
// from ~/.tokio/extra/gifts.json, which drive.mjs copies. Every viewer in the
// shots is made up.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../../..");
const out = join(repo, ".github", "screenshots");
const website = join(repo, "..", "tokio-web");
const docs = join(website, "src", "assets", "screenshots");

// Half a second of a quiet tone, as a 16-bit mono WAV. The library names
// sounds by their content, so each needs its own pitch.
function tone(file, hz) {
  const rate = 8000;
  const samples = rate / 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * hz) / rate) * 3000),
      44 + i * 2,
    );
  }
  writeFileSync(file, wav);
  return file;
}

const user = (name, handle) => ({ handle, name, picture: "" });

export default async ({ app, page, home, push, toggle }) => {
  mkdirSync(out, { recursive: true });
  const web = existsSync(website);
  if (web) mkdirSync(docs, { recursive: true });
  else console.log(`No ${website}: skipping the docs' screenshots.`);

  const nav = page.getByRole("navigation");
  const dialog = page.getByRole("dialog");
  const titleBar = page.getByRole("banner").first();
  const section = (title) =>
    page.locator("section").filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });
  // A section's controls, without its title column
  const body = (title) => section(title).locator('[class*="section_body"]');
  // The card around an overlay's name, in the gallery or the catalog
  const card = (name) =>
    page
      .getByRole("heading", { name, exact: true })
      .locator("xpath=ancestor::div[.//button and (.//iframe or .//img)][1]");

  const open = async (link, heading) => {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  };
  // Away from the sidebar's tooltips, without the toasts or a focused field
  const settle = async () => {
    await page.mouse.move(1190, 790);
    await page.evaluate(() => document.activeElement?.blur());
    const toasts = page
      .locator('[role="status"], [role="alert"]')
      .filter({ has: page.getByTitle("Close", { exact: true }) });
    while ((await toasts.count()) > 0) {
      await toasts.first().getByTitle("Close", { exact: true }).click();
    }
    await page.waitForTimeout(800);
  };
  const shoot = async (name) => {
    await settle();
    await page.screenshot({ path: join(out, `${name}.png`), scale: "css" });
  };
  // A docs screenshot of these elements and some room around them, below the
  // title bar unless `top` says otherwise. `width` cuts it short of empty
  // space on the right, `left` starts it further left.
  const crop = async (name, targets, { pad = 24, width, left, top } = {}) => {
    if (!web) return;
    const all = [targets].flat();
    await all[0].evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settle();
    const boxes = await Promise.all(all.map((t) => t.boundingBox()));
    const view = await page.evaluate(() => [innerWidth, innerHeight]);
    top ??= (await titleBar.boundingBox()).height;
    const x = Math.max(0, left ?? Math.min(...boxes.map((b) => b.x)) - pad);
    const y = Math.max(top, Math.min(...boxes.map((b) => b.y)) - pad);
    const right = Math.min(
      view[0],
      width
        ? Math.min(...boxes.map((b) => b.x)) + width + pad
        : Math.max(...boxes.map((b) => b.x + b.width)) + pad,
    );
    const bottom = Math.min(
      view[1],
      Math.max(...boxes.map((b) => b.y + b.height)) + pad,
    );
    await page.screenshot({
      path: join(docs, `${name}.png`),
      clip: { x, y, width: right - x, height: bottom - y },
    });
  };
  // Answers the next file picker with this file
  const pick = (file) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, file);

  await page.getByRole("heading", { name: "Dashboard" }).waitFor();

  // The overlay server, through IPC as e2e/app.spec.ts does: the Settings
  // switch asks first
  await page.evaluate(() =>
    Reflect.get(globalThis, "api").emit("app:settings:set:server", {
      enabled: true,
    }),
  );

  // Overlays
  await open("Overlays", "Overlay Gallery");
  await page.getByRole("button", { name: "Official Overlays" }).click();
  await page.getByRole("heading", { name: "Official Overlays" }).waitFor();
  for (const name of ["Gift Jar", "Top Likes"]) {
    const install = card(name).getByRole("button", { name: "Install" });
    await install.click();
    await install.waitFor({ state: "detached" });
  }
  await page.waitForTimeout(3000);
  await crop("overlays-official", card("Like Fountain"));
  await page.getByTitle("Back to Overlays").click();
  await page.getByRole("heading", { name: "Overlay Gallery" }).waitFor();
  await page.waitForTimeout(8000);
  await shoot("overlays");
  await crop("overlays-card", card("Gift Jar"));
  await card("Gift Jar").getByRole("button", { name: "Customize" }).click();
  await dialog.waitFor();
  await page.waitForTimeout(3000);
  await crop("overlays-customize", dialog);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });

  // Alerts
  await open("Alerts", "Alerts");
  const media = join(home, "tokio-logo.png");
  copyFileSync(join(repo, "resources", "icon.png"), media);
  const alerts = [
    { trigger: "Follow", speak: "Thanks for the follow, {username}!" },
    {
      trigger: "Gift",
      sound: "Cash register",
      hz: 440,
      media,
      gifts: ["Rose", "Galaxy"],
    },
    { trigger: "Chat", sound: "Airhorn", hz: 523, keyword: "hype" },
    { trigger: "Share", sound: "Applause", hz: 659 },
    {
      trigger: "Member Join",
      sound: "Doorbell",
      hz: 784,
      user: "@regular.viewer",
    },
  ];
  for (const alert of alerts) {
    await page.getByRole("button", { name: "Add alert" }).first().click();
    // A new alert goes to the end of the list
    await page.getByRole("combobox", { name: "Trigger" }).last().click();
    await page
      .getByRole("option", { name: alert.trigger, exact: true })
      .click();

    await page
      .getByRole("button", { name: "Select a sound..." })
      .last()
      .click();
    if (alert.speak) {
      await dialog.getByRole("tab", { name: "Text-to-speech" }).click();
      await dialog
        .getByPlaceholder("Type what the alert says...")
        .fill(alert.speak);
      await dialog.getByRole("button", { name: "Use text-to-speech" }).click();
    } else {
      await pick(tone(join(home, `${alert.sound}.wav`), alert.hz));
      await dialog.getByRole("button", { name: "Browse file..." }).click();
    }
    await dialog.waitFor({ state: "detached" });

    if (alert.media) {
      await page
        .getByRole("button", { name: "Select media..." })
        .last()
        .click();
      await pick(alert.media);
      await dialog.getByRole("button", { name: "Browse file..." }).click();
      await dialog.getByTitle("tokio-logo").click();
      await crop("alerts-media", dialog);
      await dialog.getByRole("button", { name: "Done" }).click();
      await dialog.waitFor({ state: "detached" });
    }
    if (alert.gifts) {
      await page.getByRole("button", { name: "Any gift" }).click();
      for (const gift of alert.gifts) {
        await dialog.getByTitle(gift, { exact: true }).click();
      }
      await dialog
        .getByRole("combobox")
        .filter({ hasText: "Any price" })
        .click();
      await page.getByRole("option", { name: "At least", exact: true }).click();
      await dialog.getByLabel("Coins", { exact: true }).fill("1000");
      await page.waitForTimeout(1500);
      await crop("alerts-gifts", dialog);
      await dialog.getByRole("button", { name: "Done" }).click();
      await dialog.waitFor({ state: "detached" });
    }
    if (alert.keyword) {
      await page.getByPlaceholder("Any message").fill(alert.keyword);
    }
    if (alert.user) {
      await page.getByPlaceholder("Anyone").fill(alert.user);
    }
  }
  await shoot("alerts");
  await crop("alerts-queue", section("Alerts"), { width: 640 });
  // The list, from its column headers
  await crop(
    "alerts",
    page.getByText("Volume", { exact: true }).locator("xpath=ancestor::div[2]"),
  );
  await page.getByRole("button", { name: "Cash register" }).click();
  await crop("alerts-sounds", dialog);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Thanks for the follow/ }).click();
  await dialog.getByRole("tab", { name: "Text-to-speech" }).click();
  await crop("alerts-tts", dialog);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Text-to-speech: pick a voice, then show the list around it
  await open("TTS", "Voice");
  const voice = page
    .getByRole("group", { name: "Voice Selection" })
    .getByRole("button");
  await voice.click();
  await dialog.getByPlaceholder("Search voices...").fill("Jenny");
  await dialog.getByTitle("Jenny", { exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await voice.click();
  await dialog.getByTitle("Jenny", { exact: true }).waitFor();
  await shoot("text-to-speech");
  await crop("tts-voices", dialog);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByPlaceholder("Type a message to test how the TTS sounds...")
    .fill("brb, getting a drink");
  await crop("tts-voice", body("Voice"));
  await crop("tts-format", body("Format"));
  const replacements = [
    ["brb", "be right back"],
    ["gg", "good game"],
  ];
  for (const [word, sound] of replacements) {
    await page.getByTitle("Add Replacement").click();
    await page
      .getByPlaceholder("Word to replace (e.g. 'brb')")
      .last()
      .fill(word);
    await page
      .getByPlaceholder("How it sounds (e.g. 'be right back')")
      .last()
      .fill(sound);
  }
  await crop("tts-replacements", body("Replacements"));
  await section("Permissions")
    .getByRole("checkbox", { name: "Enable Whitelist / Blacklist" })
    .check();
  await section("Permissions")
    .getByRole("group", { name: /^Blacklist/ })
    .getByRole("textbox")
    .fill("@spam.account");
  await crop("tts-permissions", body("Permissions"));
  await page.getByPlaceholder("word1, word2, word3...").fill("spoiler, spam");
  await crop("tts-protection", body("Protection"));

  // Music
  await open("Music", "Controls");
  await crop("music-provider", section("Provider"), { width: 560 });
  // Spotify's Client ID field, then back to YouTube for Home's shots
  await page.getByRole("tab", { name: "Spotify" }).click();
  await page.waitForTimeout(500);
  await crop("music-spotify", section("Provider"), { width: 680 });
  await page.getByRole("tab", { name: "YouTube" }).click();
  await crop("music-commands", section("Controls"), { width: 600 });
  await section("Protection")
    .getByRole("checkbox", { name: "One request per viewer" })
    .check();
  await crop("music-protection", body("Protection"));

  // Countdown timer
  await open("Tools", "Countdown Timer");
  await page
    .getByRole("group", { name: "Title (optional)" })
    .getByRole("textbox")
    .fill("Subathon");
  await page
    .getByRole("heading", { name: "Countdown Timer" })
    .scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(1500);
  await shoot("countdown-timer");
  await crop("timer-controls", body("Countdown Timer"));
  await crop("timer-time-added", body("Time Added"));
  await toggle(
    page.getByRole("checkbox", { name: "Show the triggers, one at a time" }),
  );
  await crop("timer-look", body("Timer Look"));
  await page.getByPlaceholder("Overlay name").fill("My overlay");
  await page.getByTitle("Create ID").click();
  await crop("tools-test-overlays", section("Test Overlays"));

  // Settings, with a made-up network address
  await open("Settings", "Live Profiles");
  await section("Overlay Server")
    .getByText(/^\d+\.\d+\.\d+\.\d+$/)
    .evaluate((el) => (el.textContent = "192.168.1.20"));
  await crop("settings-tiktok-live", section("TikTok LIVE"), { width: 640 });
  await crop("settings-overlay-server", section("Overlay Server"), {
    width: 640,
  });
  await crop("settings", [section("TikTok LIVE"), section("Tray")], {
    width: 640,
  });
  await crop("settings-profiles", section("Live Profiles"));
  await crop("settings-libraries", [
    section("Sound Library"),
    section("Media Library"),
  ]);
  // An overlay of your own, the e2e fixture under the docs' example name
  const own = join(home, "likes-counter");
  cpSync(join(repo, "test", "fixtures", "overlay"), own, { recursive: true });
  writeFileSync(
    join(own, "info.yaml"),
    "name: Likes Counter\nversion: 1.0.0\nconfig: false\n",
  );
  await pick(own);
  await section("Overlay Library")
    .getByRole("button", { name: "Import" })
    .click();
  await section("Overlay Library").getByText("Likes Counter").waitFor();
  await crop("settings-overlay-library", section("Overlay Library"));
  await page.getByTitle("Create New Profile").click();
  await page.getByPlaceholder("e.g. Chill Stream").fill("Just Chatting");
  await page.getByRole("button", { name: "Create Profile" }).click();
  await dialog.waitFor({ state: "detached" });

  // The title bar's menus, with the window's right half around them. Closing
  // a toast is a click outside, which closes a menu, so they go first. The
  // profiles can't be switched while connected, so before the LIVE.
  const menu = titleBar.locator('[class*="menu"]');
  await settle();
  const profiles = titleBar.getByRole("button", { name: "Default" }).first();
  await profiles.click();
  await crop("profiles-menu", [profiles, menu], { left: 600, top: 0 });
  await profiles.click();

  // Home, LIVE, last: what main would push while connected
  await open("Home", "Dashboard");
  for (const feature of ["TTS", "Alerts"]) {
    await toggle(page.getByRole("checkbox", { name: feature, exact: true }));
  }
  await crop("home-features", section("Active Features"));
  await page.getByTitle("Feed settings").click();
  await crop("home-feed-settings", dialog);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByPlaceholder("@username").fill("@tokio.demo");
  const gifts = JSON.parse(
    readFileSync(join(home, ".tokio", "extra", "gifts.json"), "utf8"),
  );
  const gift = (label, count) => {
    const { img, coins } = gifts.find((g) => g.label === label);
    return { name: label, image: img, count, coins: coins * count };
  };
  const activity = [
    {
      type: "chat",
      user: user("Maya", "maya.draws"),
      text: "this song is a vibe 🎶",
      emotes: [],
    },
    { type: "gift", user: user("Leo", "leo_on_air"), gift: gift("Galaxy", 1) },
    { type: "follow", user: user("Sunny Fox", "sunnyfox") },
    {
      type: "chat",
      user: user("Pixel Panda", "pixel.panda"),
      text: "!play Blinding Lights",
      emotes: [],
    },
    { type: "gift", user: user("Ana", "ana.bakes"), gift: gift("Rose", 5) },
    {
      type: "join",
      users: [
        user("Kai", "kai.k"),
        user("Noor", "noor22"),
        user("Theo", "theo.plays"),
      ],
      count: 7,
    },
    { type: "share", user: user("Jules", "jules.mp4") },
    {
      type: "chat",
      user: user("Ravi", "ravi.codes"),
      text: "hi from Lisbon 👋",
      emotes: [],
    },
    { type: "superfan", user: user("Emma", "emma.m") },
    {
      type: "gift",
      user: user("Sam", "samwise"),
      gift: gift("Finger Heart", 3),
    },
  ].map((item, id) => ({ ...item, id: 100 - id }));
  await push("app:home:res:connect", {
    success: true,
    stats: { views: 18250, viewers: 342, likes: 52410 },
  });
  await push("app:home:res:session", {
    data: {
      startedAt: Date.now() - (1 * 60 + 23) * 60_000,
      totals: { followers: 48, shares: 17, gifts: 126, coins: 3480 },
      activity,
    },
  });
  await shoot("dashboard");
  await crop("dashboard", page.locator("body"), { pad: 0 });

  await settle();
  const bell = titleBar.getByTitle("Notifications");
  await bell.click();
  await crop("notifications", [bell, menu], { left: 600, top: 0 });
};
