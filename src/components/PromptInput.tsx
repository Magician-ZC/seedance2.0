import { useRef, useEffect } from 'react';

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const PLACEHOLDER =
  '上传 1-5 张参考图或视频，可自由组合人物、角色、道具、服装、场景等元素，定义他们之间的精彩互动。例如：@图片1作为首帧，@图片2作为尾帧，模仿@视频1的动作跳舞';

export default function PromptInput({ value, onChange, disabled }: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  return (
    <div className="relative group">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDER}
        disabled={disabled}
        rows={2}
        className="w-full bg-transparent border-none outline-none resize-none text-sm text-gray-200 placeholder-gray-600 leading-relaxed disabled:opacity-50 min-h-[60px]"
      />
      <div className="absolute bottom-0 right-0 h-px w-0 bg-gradient-to-r from-transparent via-green-500 to-transparent group-focus-within:w-full transition-all duration-500"></div>
    </div>
  );
}
