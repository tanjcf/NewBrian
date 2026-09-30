/** Encode interleaved signed PCM without gain, normalization or time stretching. */
export function encodeVoiceWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length || 0;
  if (!channels.length || channels.some(c => c.length !== frames)) throw new Error("音频通道长度无效");
  const bytes = new Uint8Array(44 + frames * channels.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels.length; c++) {
    const value = Math.max(-1, Math.min(1, channels[c]![i]!));
    view.setInt16(44 + (i * channels.length + c) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function joinVoiceAudio(urls: string[]): Promise<{ audioBase64: string; duration: number }> {
  const decoder = new AudioContext({ sampleRate: 48000 });
  try {
    const clips: AudioBuffer[] = [];
    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("候选音频读取失败");
      clips.push(await decoder.decodeAudioData(await response.arrayBuffer()));
    }
    const frames = clips.reduce((sum, c) => sum + c.length, 0);
    const count = Math.max(...clips.map(c => c.numberOfChannels));
    if (!frames || !Number.isFinite(count)) throw new Error("场景没有可播放音频");
    const channels = Array.from({ length: count }, () => new Float32Array(frames));
    let offset = 0;
    for (const clip of clips) {
      channels.forEach((channel, i) => channel.set(clip.getChannelData(Math.min(i, clip.numberOfChannels - 1)), offset));
      offset += clip.length;
    }
    const bytes = encodeVoiceWav(channels, decoder.sampleRate);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { audioBase64: btoa(binary), duration: frames / decoder.sampleRate };
  } finally { await decoder.close(); }
}
