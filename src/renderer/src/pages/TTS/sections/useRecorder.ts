import { APP_EVENTS, APP_EVENTS_RESPONSE, CameraFailure } from "@/common/types";
import { mediaFailure } from "@/helper/camera";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useEffect, useRef, useState } from "react";

const MIME_TYPE = "audio/webm;codecs=opus";

type Session = {
  stream: MediaStream;
  recorder: MediaRecorder;
  tick: ReturnType<typeof setInterval>;
  limit: ReturnType<typeof setTimeout>;
};

/**
 * Records the microphone, unprocessed, for voice samples. `record` asks main
 * first (macOS asks the user), `stop` hands the bytes to onRecorded, and
 * unmounting drops the recording and lets the microphone go. A recording
 * stops by itself at maxSeconds.
 */
export function useRecorder(
  maxSeconds: number,
  onRecorded: (data: Uint8Array) => void,
) {
  // "starting" from the click until the microphone opens
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const session = useRef<Session | null>(null);
  const mounted = useRef(true);
  const recorded = useRef(onRecorded);
  recorded.current = onRecorded;

  const end = (keep: boolean) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    clearInterval(current.tick);
    clearTimeout(current.limit);
    if (!keep) current.recorder.onstop = null;
    if (current.recorder.state !== "inactive") current.recorder.stop();
    current.stream.getTracks().forEach((t) => t.stop());
    if (mounted.current) setState("idle");
  };

  const open = async () => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!mounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const recorder = new MediaRecorder(stream, {
        mimeType: MIME_TYPE,
        audioBitsPerSecond: 128000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: MIME_TYPE });
        recorded.current(new Uint8Array(await blob.arrayBuffer()));
      };
      // Not Date.now(), so a clock change can't skew the time shown
      const started = performance.now();
      session.current = {
        stream,
        recorder,
        tick: setInterval(
          () => setSeconds(Math.floor((performance.now() - started) / 1000)),
          250,
        ),
        limit: setTimeout(() => end(true), maxSeconds * 1000),
      };
      // Unplugged: what was recorded is kept
      stream
        .getAudioTracks()[0]
        ?.addEventListener("ended", () => end(true), { once: true });
      recorder.start();
      setSeconds(0);
      setState("recording");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (!mounted.current) return;
      setFailure(mediaFailure(e));
      setState("idle");
    }
  };

  useIpcListener(APP_EVENTS_RESPONSE.ASK_MICROPHONE, (res) => {
    if (state !== "starting") return;
    if (!res?.success || !res.granted) {
      setFailure("blocked");
      setState("idle");
      return;
    }
    void open();
  });

  const record = () => {
    setFailure(null);
    setState("starting");
    window.api.emit(APP_EVENTS.ASK_MICROPHONE);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      end(false);
    };
  }, []);

  return {
    state,
    seconds,
    failure,
    record,
    stop: () => end(true),
  };
}
