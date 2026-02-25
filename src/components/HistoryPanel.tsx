import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getHistory, removeHistory, clearHistory, type HistoryRecord } from '../services/historyService';
import { CloseIcon, DownloadIcon } from './Icons';
import VideoThumbnail from './VideoThumbnail';

interface HistoryPanelProps {
  onSelect: (record: HistoryRecord) => void;
  onClose: () => void;
}

export default function HistoryPanel({ onSelect, onClose }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<HistoryRecord[]>([]);

  useEffect(() => { setRecords(getHistory()); }, []);

  const handleDelete = (id: string) => {
    removeHistory(id);
    setRecords(getHistory());
  };

  const handleClearAll = () => {
    clearHistory();
    setRecords([]);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f2e] border border-gray-800 rounded-3xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-gray-200 font-medium">{t('history.title')}</h2>
          <div className="flex items-center gap-2">
            {records.length > 0 && (
              <button onClick={handleClearAll} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded">
                {t('history.clearAll')}
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800">
              <CloseIcon className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
          {records.length === 0 ? (
            <div className="text-center text-gray-500 py-12">{t('history.empty')}</div>
          ) : records.map((record) => (
            <div key={record.id} className="bg-[#161824] rounded-xl p-3 border border-gray-800 hover:border-gray-700 transition-colors group">
              <div className="flex gap-3">
                {record.videoUrl && record.status === 'done' && (
                  <div className="w-24 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-black cursor-pointer" onClick={() => onSelect(record)}>
                    <VideoThumbnail videoUrl={record.videoUrl} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-300 truncate">{record.prompt || '(无提示词)'}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <span>{record.model}</span>
                    <span>·</span>
                    <span>{record.ratio}</span>
                    <span>·</span>
                    <span>{record.duration}s</span>
                    <span>·</span>
                    <span className={record.status === 'done' ? 'text-green-400' : 'text-red-400'}>
                      {t(`history.status.${record.status}`)}
                    </span>
                    <span>·</span>
                    <span>{new Date(record.createdAt).toLocaleString()}</span>
                  </div>
                  {record.error && <p className="text-xs text-red-400 mt-1 truncate">{record.error}</p>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {record.videoUrl && record.status === 'done' && (
                    <a href={`/api/video-proxy?url=${encodeURIComponent(record.videoUrl)}`} download className="p-1.5 rounded-lg hover:bg-gray-700">
                      <DownloadIcon className="w-4 h-4 text-gray-400" />
                    </a>
                  )}
                  <button onClick={() => handleDelete(record.id)} className="p-1.5 rounded-lg hover:bg-gray-700">
                    <CloseIcon className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
