import { useEffect, useRef, useState } from 'react';

/**
 * Opens the webcam and attaches the stream to a <video> element via ref.
 * Returns the ready video element (or null until it's playing) plus status
 * for the fallback UI.
 *
 * We keep this minimal: camera gate + lifecycle. The actual recognition is
 * the GestureEngine's job once `video` is ready.
 */
export type WebcamStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'no-device' | 'error';

export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<WebcamStatus>('idle');

  useEffect(() => {
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    async function start() {
      setStatus('requesting');
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('no-device');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setStatus('no-device');
        else setStatus('error');
      }
    }

    start();
    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { videoRef, status };
}
