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
    <div className="relative w-full h-[160px] md:h-[180px] rounded-2xl overflow-hidden bg-[#1a1a1a]">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-gradient-to-r from-green-600/30 to-transparent" />
        <div
          className="absolute right-0 top-0 w-1/2 h-full"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2322c55e' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-r ${slide.gradient}`} />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-8">
        <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
          {isZh ? slide.titleZh : slide.titleEn}
        </h2>
        <p className="text-sm text-gray-300 mb-4 max-w-md">
          {isZh ? slide.descZh : slide.descEn}
        </p>
        <div>
          <button className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors">
            {isZh ? '立即体验' : 'Try Now'}
          </button>
        </div>
      </div>

      {/* Dots */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`banner-dot h-1.5 rounded-full transition-all ${
              i === current ? 'active bg-white w-6' : 'bg-white/40 w-1.5'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
