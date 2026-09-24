import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativePlaybackState = {
  position: number;
  duration: number;
  isPlaying: boolean;
  ended: boolean;
  width?: number;
  height?: number;
};

export interface NativePlaybackPlugin {
  open(options: { url: string; mimeType?: string; headers?: Record<string, string>; start?: number }): Promise<void>;
  setRect(options: { x: number; y: number; width: number; height: number }): Promise<void>;
  setVisible(options: { visible: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(options: { position: number }): Promise<void>;
  setRate(options: { rate: number }): Promise<void>;
  exitApp(): Promise<void>;
  release(): Promise<void>;
  addListener(eventName: 'state', listenerFunc: (state: NativePlaybackState) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'ended', listenerFunc: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'error', listenerFunc: (error: { message?: string }) => void): Promise<PluginListenerHandle>;
}

export const NativePlayback = registerPlugin<NativePlaybackPlugin>('NativePlayback');
