import { AudioQueue, decodeSound } from "@/helper/audio";
import React, { createContext, useCallback, useMemo, useRef } from "react";
import * as Tone from "tone";

export interface AudioContextType {
  getQueue: (name: string) => AudioQueue;
  stopQueues: (prefix: string) => void;
  setItemGain: (key: string, gain: number) => void;
  resumeContext: () => Promise<void>;
  // Shares the decode with the queues' copies of the sound with that key
  decode: (data: Uint8Array, cacheKey: string) => Promise<AudioBuffer>;
}

export const AudioContext = createContext<AudioContextType | null>(null);

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queuesRef = useRef<Map<string, AudioQueue>>(new Map());

  const getQueue = useCallback((name: string) => {
    if (!queuesRef.current.has(name)) {
      queuesRef.current.set(name, new AudioQueue());
    }
    return queuesRef.current.get(name)!;
  }, []);

  const stopQueues = useCallback((prefix: string) => {
    queuesRef.current.forEach((queue, name) => {
      if (name.startsWith(prefix)) queue.stop();
    });
  }, []);

  const setItemGain = useCallback((key: string, gain: number) => {
    queuesRef.current.forEach((queue) => queue.setItemGain(key, gain));
  }, []);

  const resumeContext = useCallback(async () => {
    if (Tone.getContext().state !== "running") {
      await Tone.start();
    }
  }, []);

  const value = useMemo(
    () => ({
      getQueue,
      stopQueues,
      setItemGain,
      resumeContext,
      decode: decodeSound,
    }),
    [getQueue, stopQueues, setItemGain, resumeContext],
  );

  return (
    <AudioContext.Provider value={value}>{children}</AudioContext.Provider>
  );
};
