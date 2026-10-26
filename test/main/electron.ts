import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";

// Fakes of the Electron APIs main uses. test/setup.ts mocks "electron" with
// this module, so the code under test gets them, and tests read back what it
// created, sent and registered. Don't import "electron" here.

type Bounds = { x: number; y: number; width: number; height: number };

/** An event its listeners can cancel, like Electron's. */
export function cancelableEvent<T extends object>(props: T) {
  const event = {
    ...props,
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };
  return event;
}

export class FakeWebContents extends EventEmitter {
  // Messages from this page only, which main can handle without ipcMain
  readonly ipc = new EventEmitter();
  readonly session = {
    clearStorageData: vi.fn(async () => {}),
    setPermissionRequestHandler:
      vi.fn<
        (
          handler: (
            contents: unknown,
            permission: string,
            callback: (granted: boolean) => void,
          ) => void,
        ) => void
      >(),
    setPermissionCheckHandler:
      vi.fn<
        (handler: (contents: unknown, permission: string) => boolean) => void
      >(),
  };
  readonly send = vi.fn<(channel: string, ...args: unknown[]) => void>();
  readonly setWindowOpenHandler =
    vi.fn<
      (
        handler: (details: { url: string }) => { action: "allow" | "deny" },
      ) => void
    >();
  readonly executeJavaScript = vi.fn<(code: string) => Promise<unknown>>(
    async () => undefined,
  );
  readonly insertCSS = vi.fn<(css: string) => Promise<string>>(async () => "");
  readonly sendInputEvent =
    vi.fn<(event: { type: string; keyCode: string }) => void>();
  readonly setAudioMuted = vi.fn<(muted: boolean) => void>();
  readonly loadURL = vi.fn<(url: string) => Promise<void>>(async (url) => {
    this.url = url;
  });
  readonly loadFile = vi.fn<(file: string) => Promise<void>>(async (file) => {
    this.url = pathToFileURL(file).href;
  });
  readonly close = vi.fn<() => void>(() => this.destroy());
  private url = "";
  private destroyed = false;

  getURL() {
    return this.url;
  }

  isDestroyed() {
    return this.destroyed;
  }

  /** What happens to it when its window or view goes away. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
  }
}

export class FakeWebContentsView {
  readonly webContents = new FakeWebContents();
  readonly setBounds = vi.fn<(bounds: Bounds) => void>();

  constructor(
    readonly options: { webPreferences?: Record<string, unknown> } = {},
  ) {
    fakes.created.views.push(this);
  }
}

type WindowOptions = {
  width?: number;
  height?: number;
  show?: boolean;
  webPreferences?: Record<string, unknown>;
  [option: string]: unknown;
};

export class FakeBrowserWindow extends EventEmitter {
  static getAllWindows() {
    return fakes.created.windows.filter((w) => !w.isDestroyed());
  }

  readonly webContents = new FakeWebContents();
  readonly contentView = {
    children: [] as FakeWebContentsView[],
    addChildView: vi.fn((view: FakeWebContentsView) => {
      this.contentView.children.push(view);
    }),
    removeChildView: vi.fn((view: FakeWebContentsView) => {
      const { children } = this.contentView;
      if (children.includes(view)) children.splice(children.indexOf(view), 1);
    }),
  };
  readonly show = vi.fn(() => {
    this.visible = true;
    this.emit("show");
  });
  readonly hide = vi.fn(() => {
    this.visible = false;
    this.emit("hide");
  });
  readonly minimize = vi.fn(() => {
    this.state = "minimized";
    this.emit("minimize");
  });
  readonly maximize = vi.fn(() => {
    this.state = "maximized";
    this.emit("maximize");
  });
  readonly unmaximize = vi.fn(() => {
    this.state = "normal";
    this.emit("unmaximize");
  });
  readonly restore = vi.fn(() => {
    this.state = "normal";
    this.emit("restore");
  });
  readonly focus = vi.fn();
  // Listeners of "close" can cancel it, then "closed" follows
  readonly close = vi.fn(() => {
    if (this.closing || this.destroyed) return;
    this.closing = true;
    const event = cancelableEvent({});
    this.emit("close", event);
    this.closing = false;
    if (event.defaultPrevented) return;
    this.destroyed = true;
    this.webContents.destroy();
    this.emit("closed");
  });
  readonly loadURL = vi.fn((url: string) => this.webContents.loadURL(url));
  readonly loadFile = vi.fn((file: string) => this.webContents.loadFile(file));
  private bounds: Bounds;
  private state: "normal" | "maximized" | "minimized" = "normal";
  private visible: boolean;
  private closing = false;
  private destroyed = false;

  constructor(readonly options: WindowOptions = {}) {
    super();
    this.bounds = {
      x: 0,
      y: 0,
      width: options.width ?? 800,
      height: options.height ?? 600,
    };
    this.visible = options.show ?? true;
    fakes.created.windows.push(this);
  }

  getContentBounds() {
    return { ...this.bounds };
  }

  /** Resizes it the way the user would, with its resize event. */
  resize(width: number, height: number) {
    this.bounds = { ...this.bounds, width, height };
    this.emit("resize");
  }

  isVisible() {
    return this.visible;
  }

  isMaximized() {
    return this.state === "maximized";
  }

  isNormal() {
    return this.state === "normal";
  }

  isMinimized() {
    return this.state === "minimized";
  }

  isDestroyed() {
    return this.destroyed;
  }
}

export type FakeMenuItem = { label?: string; click?: () => void };

/** A tray icon: tests click it with emit("click") and read its menu. */
export class FakeTray extends EventEmitter {
  readonly setToolTip = vi.fn<(tooltip: string) => void>();
  readonly setContextMenu = vi.fn<(menu: { items: FakeMenuItem[] }) => void>();
  readonly destroy = vi.fn();

  constructor(readonly image: unknown) {
    super();
    fakes.created.trays.push(this);
  }
}

/** A system notification: tests click it with emit("click"). */
export class FakeNotification extends EventEmitter {
  static isSupported() {
    return true;
  }

  readonly show = vi.fn();

  constructor(readonly options: { title?: string; body?: string }) {
    super();
    fakes.created.notifications.push(this);
  }
}

type RequestListener = (
  details: { url: string; resourceType: string },
  callback: (response: { cancel: boolean }) => void,
) => void;

type HeadersListener = (
  details: { url: string; responseHeaders?: Record<string, string[]> },
  callback: (response: { responseHeaders?: Record<string, string[]> }) => void,
) => void;

function createFakes() {
  return {
    created: {
      windows: [] as FakeBrowserWindow[],
      views: [] as FakeWebContentsView[],
      trays: [] as FakeTray[],
      notifications: [] as FakeNotification[],
    },
    ipcMain: new EventEmitter(),
    ipcRenderer: Object.assign(new EventEmitter(), {
      send: vi.fn<(channel: string, ...args: unknown[]) => void>(),
    }),
    contextBridge: {
      exposeInMainWorld: vi.fn<(key: string, api: unknown) => void>(),
    },
    app: Object.assign(new EventEmitter(), {
      isPackaged: false,
      commandLine: {
        appendSwitch: vi.fn<(name: string, value?: string) => void>(),
      },
      getPath: vi.fn((name: string) => `/fake/${name}`),
      setPath: vi.fn<(name: string, path: string) => void>(),
      getAppPath: vi.fn(() => "/fake/app"),
      whenReady: vi.fn(() => Promise.resolve()),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      getLocale: vi.fn(() => "en-US"),
      getLocaleCountryCode: vi.fn(() => "US"),
    }),
    session: {
      defaultSession: {
        webRequest: {
          onBeforeRequest:
            vi.fn<
              (filter: { urls: string[] }, listener: RequestListener) => void
            >(),
          onHeadersReceived: vi.fn<(listener: HeadersListener) => void>(),
        },
      },
    },
    protocol: {
      registerSchemesAsPrivileged:
        vi.fn<
          (
            schemes: { scheme: string; privileges: Record<string, boolean> }[],
          ) => void
        >(),
      handle:
        vi.fn<
          (
            scheme: string,
            handler: (request: Request) => Promise<Response>,
          ) => void
        >(),
    },
    shell: {
      openExternal: vi.fn<(url: string) => Promise<void>>(async () => {}),
    },
    Menu: {
      buildFromTemplate: vi.fn((items: FakeMenuItem[]) => ({ items })),
    },
    // Images only say what they were made from
    nativeImage: {
      createFromPath: vi.fn((path: string) => ({
        resize: (size: { width?: number; height?: number }) => ({
          path,
          ...size,
        }),
      })),
    },
    dialog: {
      showOpenDialog: vi.fn(async (..._args: unknown[]) => ({
        canceled: true,
        filePaths: [] as string[],
      })),
      showSaveDialog: vi.fn(async (..._args: unknown[]) => ({
        canceled: true,
        filePath: "",
      })),
    },
    net: {
      fetch: vi.fn<(url: string) => Promise<Response>>(
        async () => new Response(null),
      ),
    },
    // Round-trips text, with the "v10" prefix Chromium's encryption adds
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (text: string) =>
        Buffer.from(`v10${text}`, "utf-8"),
      decryptStringAsync: async (data: Buffer) => ({
        shouldReEncrypt: false,
        result: data.toString("utf-8").replace(/^v\d\d/, ""),
      }),
    },
  };
}

// vi.resetModules() evaluates this module again, and the code under test then
// gets new copies of these. They keep the first ones, so tests see the same
// fakes as the code under test.
const KEY = Symbol.for("tokio:electron-fakes");
const fakes: ReturnType<typeof createFakes> =
  Reflect.get(globalThis, KEY) ?? createFakes();
Reflect.set(globalThis, KEY, fakes);

export const {
  ipcMain,
  ipcRenderer,
  contextBridge,
  app,
  session,
  protocol,
  shell,
  dialog,
  net,
  safeStorage,
  Menu,
  nativeImage,
} = fakes;

export {
  FakeBrowserWindow as BrowserWindow,
  FakeWebContentsView as WebContentsView,
  FakeTray as Tray,
  FakeNotification as Notification,
};

/** The windows created in this test, oldest first. */
export const windows = () => [...fakes.created.windows];

/** The views created in this test, oldest first. */
export const views = () => [...fakes.created.views];

/** The tray icons created in this test, oldest first. */
export const trays = () => [...fakes.created.trays];

/** The notifications created in this test, oldest first. */
export const notifications = () => [...fakes.created.notifications];

// restoreMocks only restores spies, so the fakes' calls and implementations
// would carry over to the next test.
function resetMocks(value: unknown, seen = new Set<unknown>()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    const prop: unknown = Reflect.get(value, key);
    if (vi.isMockFunction(prop)) prop.mockReset();
    else resetMocks(prop, seen);
  }
}

/** Forgets what earlier tests created, registered and stubbed. */
export function resetElectron() {
  fakes.created.windows.length = 0;
  fakes.created.views.length = 0;
  fakes.created.trays.length = 0;
  fakes.created.notifications.length = 0;
  ipcMain.removeAllListeners();
  ipcRenderer.removeAllListeners();
  app.removeAllListeners();
  app.isPackaged = false;
  resetMocks(fakes);
}
