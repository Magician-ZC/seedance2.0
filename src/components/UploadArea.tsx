import { useRef, useCallback } from 'react';
import type { UploadedImage } from '../types';
import { PlusIcon, CloseIcon } from './Icons';

interface UploadAreaProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  maxImages?: number;
}

let nextId = 0;

export default function UploadArea({ images, onImagesChange, maxImages = 5 }: UploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const remaining = maxImages - images.length;
      if (remaining <= 0) return;

      const newFiles = Array.from(fileList).slice(0, remaining);
      const newImages: UploadedImage[] = newFiles.map((file, i) => ({
        id: `img-${++nextId}`,
        file,
        previewUrl: URL.createObjectURL(file),
        index: images.length + i + 1,
      }));

      onImagesChange([...images, ...newImages]);
    },
    [images, maxImages, onImagesChange]
  );

  const removeImage = useCallback(
    (id: string) => {
      const removed = images.find((img) => img.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);

      const updated = images
        .filter((img) => img.id !== id)
        .map((img, i) => ({ ...img, index: i + 1 }));
      onImagesChange(updated);
    },
    [images, onImagesChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const canAdd = images.length < maxImages;

  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
      {/* Uploaded thumbnails */}
      {images.map((img) => (
        <div key={img.id} className="relative group w-16 h-16 flex-shrink-0 animate-scale-in">
          <img
            src={img.previewUrl}
            alt={`参考图 ${img.index}`}
            className="w-full h-full object-cover rounded-xl border border-white/10 group-hover:border-white/30 transition-colors"
          />
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors rounded-xl" />
          <span className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-sm text-[9px] text-white px-1.5 py-0.5 rounded font-mono">
            @{img.index}
          </span>
          <button
            onClick={() => removeImage(img.id)}
            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-600 shadow-lg transform scale-75 group-hover:scale-100"
          >
            <CloseIcon className="w-3 h-3 text-white" />
          </button>
        </div>
      ))}

      {/* Add button */}
      {canAdd && (
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="w-16 h-16 flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/10 bg-[#1a1a1a] hover:bg-[#222] hover:border-green-500/50 transition-all group cursor-pointer"
        >
          <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
            <PlusIcon className="w-3.5 h-3.5 text-gray-500 group-hover:text-green-400" />
          </div>
          <span className="text-[9px] text-gray-500 group-hover:text-gray-300">Add Ref</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
