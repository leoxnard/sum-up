/**
 * Recording a voice message in the browser, and turning it into something the
 * extraction endpoint can send on: 16 kHz mono WAV as a data URL.
 *
 * The recorded container is whatever the browser gives us (webm/opus on
 * Chrome and Firefox, mp4/aac on Safari). Instead of forwarding that zoo, the
 * blob is decoded and re-encoded as WAV — a format every model accepts — which
 * also lets us downsample to 16 kHz mono, where speech loses nothing and the
 * upload shrinks by an order of magnitude.
 */

/** Long enough to describe a handful of expenses, short enough to stay uploadable. */
export const MAX_RECORDING_SECONDS = 90;

const TARGET_SAMPLE_RATE = 16_000;

const CONTAINERS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/aac",
];

export interface Recorder {
  /** Stop, release the microphone and hand back what was recorded. */
  stop(): Promise<Blob>;
  /** Stop and throw the recording away (navigating away, changing your mind). */
  cancel(): void;
  /** Current input loudness, 0–1, for the level meter. */
  level(): number;
}

export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Rejects with "denied" when the user says no to the microphone prompt. */
export async function startRecording(): Promise<Recorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    throw new Error(
      error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
        ? "denied"
        : "unavailable",
    );
  }

  const mimeType = CONTAINERS.find((type) => MediaRecorder.isTypeSupported?.(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  // A meter off the live stream: cheap, and it makes it obvious that the
  // microphone is actually picking the speaker up.
  const context = new AudioContext();
  // Awaiting getUserMedia can cost us the user gesture, and a context that
  // starts suspended would leave the meter flat at zero for the whole take.
  void context.resume().catch(() => {});
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  // The graph is only pulled where it reaches the destination, so the analyser
  // is routed there through a muted gain node — an analyser dangling off the
  // source alone never sees a sample in some browsers.
  const mute = context.createGain();
  mute.gain.value = 0;
  context.createMediaStreamSource(stream).connect(analyser);
  analyser.connect(mute).connect(context.destination);
  const samples = new Uint8Array(analyser.fftSize);

  function release() {
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => {});
  }

  return {
    stop() {
      return new Promise<Blob>((resolve, reject) => {
        if (recorder.state === "inactive") {
          release();
          reject(new Error("unavailable"));
          return;
        }
        recorder.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
          if (blob.size === 0) reject(new Error("empty"));
          else resolve(blob);
        };
        recorder.stop();
      });
    },
    cancel() {
      if (recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      release();
    },
    level() {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
      // 128 is full scale; the curve lifts quiet speech into a visible range.
      return Math.min(1, (peak / 128) * 2.2);
    },
  };
}

/**
 * Decode a recording and re-encode it as a 16 kHz mono WAV data URL, cut off
 * after `maxSeconds`. Throws when the browser can't decode its own recording.
 */
export async function toWavDataUrl(
  blob: Blob,
  maxSeconds = MAX_RECORDING_SECONDS,
): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(bytes);
  } finally {
    void context.close().catch(() => {});
  }

  const seconds = Math.min(decoded.duration, maxSeconds);
  const mono = await resampleToMono(decoded, seconds, TARGET_SAMPLE_RATE);
  return `data:audio/wav;base64,${base64(encodeWav(mono.samples, mono.sampleRate))}`;
}

/** Duration of a recorded blob in seconds, or null when it can't be decoded. */
export async function durationOf(blob: Blob): Promise<number | null> {
  const context = new AudioContext();
  try {
    return (await context.decodeAudioData(await blob.arrayBuffer())).duration;
  } catch {
    return null;
  } finally {
    void context.close().catch(() => {});
  }
}

async function resampleToMono(
  buffer: AudioBuffer,
  seconds: number,
  sampleRate: number,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const frames = Math.max(1, Math.round(seconds * sampleRate));
  try {
    const offline = new OfflineAudioContext(1, frames, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0), sampleRate };
  } catch {
    // Some browsers refuse an OfflineAudioContext at 16 kHz. Downmixing at the
    // original rate costs upload size but always works.
    return { samples: downmix(buffer, seconds), sampleRate: buffer.sampleRate };
  }
}

function downmix(buffer: AudioBuffer, seconds: number): Float32Array {
  const frames = Math.min(buffer.length, Math.round(seconds * buffer.sampleRate));
  const out = new Float32Array(frames);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

/** Minimal 16-bit PCM WAV container around the samples. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return bytes;
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  // btoa takes a string; chunked so a minute of audio doesn't blow the stack.
  let binary = "";
  for (let i = 0; i < view.length; i += 8192) {
    binary += String.fromCharCode(...view.subarray(i, i + 8192));
  }
  return btoa(binary);
}
