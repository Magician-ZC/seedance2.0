import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface BannerSlide {
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  gradient: string;
  image?: string;
}

const SLIDES: BannerSlide[] = [
  {
    titleZh: 'Seedance 2.0 全新能力',
    titleEn: 'Seedance 2.0 New Features',
    descZh: '从文字描述生成高质量视频，或上传参考图进行创作',
    descEn: 'Generate high-quality videos from text or reference images',
    gradient: 'from-green-900/80 via-green-900/40 to-transparent',
  },
  {
    titleZh: '小说转短剧',
    titleEn: 'Novel to Drama',
    descZh: '一键将小说转化为分镜脚本，自动生成短剧视频',
    descEn: 'Convert novels to storyboard scripts and auto-generate drama videos',
    gradient: 'from-emerald-900/80 via-emerald-900/40 to-transparent',
  },
  {
    titleZh: '批量视频生成',
    titleEn: 'Batch Video Generation',
    descZh: '支持多集短剧批量生成，高效完成视频制作',
    descEn: 'Batch generate multi-episode dramas efficiently',
    gradient: 'from-teal-900/80 via-teal-900/40 to-transparent',
  },
];

export default function Banner() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [current, setCurrent] = useState(0);

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % SLIDES.length);
  }, []);

  useEffect(() => {
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  }, [next]);

  const slide = SLIDES[current];

  return (
    <div className="relative w-full h-[200px] md:h-[240px] rounded-3xl overflow-hidden bg-[#0a0a0a] border border-white/5 shadow-2xl group">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-30 transition-opacity duration-1000 group-hover:opacity-40">
        <div className="absolute inset-0 bg-gradient-to-r from-green-600/20 to-transparent mix-blend-screen" />
        <div
          className="absolute right-0 top-0 w-2/3 h-full opacity-20"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2322c55e' fill-opacity='0.2'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            backgroundSize: '60px 60px',
          }}
        />
        {/* Animated Glow */}
        <div className="absolute -inset-[50%] bg-gradient-to-tr from-green-500/10 via-transparent to-transparent blur-3xl animate-pulse-glow opacity-50" />
      </div>

      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-r ${slide.gradient} transition-colors duration-1000`} />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col justify-center px-8 md:px-12 max-w-3xl">
        <div className="animate-fade-in key={current}">
          <h2 className="text-2xl md:text-4xl font-bold text-white mb-3 tracking-tight drop-shadow-lg">
            {isZh ? slide.titleZh : slide.titleEn}
          </h2>
          <p className="text-base md:text-lg text-gray-200 mb-6 max-w-xl font-light leading-relaxed drop-shadow-md">
            {isZh ? slide.descZh : slide.descEn}
          </p>
          <div>
            <button className="px-6 py-2.5 bg-white text-green-900 hover:bg-gray-100 text-sm font-semibold rounded-full transition-all hover:scale-105 shadow-lg shadow-green-900/20 active:scale-95">
              {isZh ? '立即体验' : 'Try Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Dots */}
      <div className="absolute bottom-6 left-8 md:left-12 flex gap-2 z-20">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i === current ? 'bg-white w-8 shadow-[0_0_10px_rgba(255,255,255,0.5)]' : 'bg-white/30 w-1.5 hover:bg-white/60'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
