import { useRef, useEffect, useState } from 'react';
import { FilmIcon } from './Icons';

interface VideoThumbnailProps {
  videoUrl: string;
  className?: string;
}

function proxyUrl(url: string): string {
  return `/api/video-proxy?url=${encodeURIComponent(url)}`;
}

export default function VideoThumbnail({ videoUrl, className = '' }: VideoThumbnailProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    video.crossOrigin = 'anonymous';
    video.src = proxyUrl(videoUrl);
    video.currentTime = 1; // 截取第1秒的帧

    const handleSeeked = () => {
      try {
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          setThumbnail(canvas.toDataURL('image/jpeg', 0.7));
        }
      } catch {
        setError(true);
      }
    };

    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', () => setError(true), { once: true });

    return () => {
      video.removeEventListener('seeked', handleSeeked);
      video.src = '';
    };
  }, [videoUrl]);

  if (error || !thumbnail) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-[#161824] ${className}`}>
        <FilmIcon className="w-6 h-6 text-gray-600" />
        <video ref={videoRef} className="hidden" muted preload="metadata" />
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  return (
    <>
      <img src={thumbnail} alt="thumbnail" className={`w-full h-full object-cover ${className}`} />
      <video ref={videoRef} className="hidden" muted preload="metadata" />
      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}
