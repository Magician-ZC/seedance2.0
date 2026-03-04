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
  const [loading, setLoading] = useState(true);

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
          setLoading(false);
        }
      } catch {
        setError(true);
        setLoading(false);
      }
    };

    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', () => { setError(true); setLoading(false); }, { once: true });

    return () => {
      video.removeEventListener('seeked', handleSeeked);
      video.src = '';
    };
  }, [videoUrl]);

  if (error) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-[#111] ${className}`}>
        <FilmIcon className="w-8 h-8 text-gray-700" />
      </div>
    );
  }

  if (loading || !thumbnail) {
    return (
      <div className={`w-full h-full bg-[#111] animate-pulse flex items-center justify-center ${className}`}>
        <div className="w-8 h-8 border-2 border-white/10 border-t-white/30 rounded-full animate-spin" />
        <video ref={videoRef} className="hidden" muted preload="metadata" />
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  return (
    <>
      <img src={thumbnail} alt="thumbnail" className={`w-full h-full object-cover transition-opacity duration-500 ${className}`} />
      <video ref={videoRef} className="hidden" muted preload="metadata" />
      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}
