// 配音管理面板：音色列表 + 角色绑定 + TTS配置（持久化） + 批量生成
import { useState, useEffect } from 'react';
import * as api from '../../services/productionService';

interface Props {
  projectId: string;
  assets: Array<Record<string, unknown>>;
  voices: Array<Record<string, unknown>>;
  onRefresh: () => void;
}

interface VoiceOption {
  voiceId: string;
  name: string;
  gender: string;
  language: string;
  tags: string[];
}

export default function VoicePanel({ projectId, assets, voices, onRefresh }: Props) {
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [appId, setAppId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [clusterId, setClusterId] = useState('volcano_tts');
  const [configured, setConfigured] = useState(false);
  const [savedAppIdHint, setSavedAppIdHint] = useState('');
  const [savedClusterId, setSavedClusterId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const characterAssets = assets.filter(a => a.assetType === 'character');

  useEffect(() => {
    api.getVoiceConfig().then(data => {
      if (data?.configured) {
        setConfigured(true);
        if (data.appId) setSavedAppIdHint(data.appId);
        if (data.clusterId) setSavedClusterId(data.clusterId);
      }
    }).catch(() => {});
    api.listVoices('all').then(data => {
      if (data?.voices) setVoiceOptions(data.voices);
    }).catch(() => {});
  }, []);

  const handleSaveConfig = async () => {
    setErrMsg('');
    try {
      await api.configureDoubaoTTS(appId, accessToken, clusterId);
      setConfigured(true);
      setSavedAppIdHint(appId.slice(0, 4) + '****');
      setSavedClusterId(clusterId);
      setShowConfig(false);
      setAppId('');
      setAccessToken('');
    } catch (e) { setErrMsg(String(e)); }
  };

  const handleBindVoice = async (characterAssetId: string, voiceId: string) => {
    const voice = voiceOptions.find(v => v.voiceId === voiceId);
    const existing = voices.find(v => (v.characterAssetId as string) === characterAssetId);
    if (existing) {
      await api.updateVoiceBinding(existing.id as string, { voiceId, voiceName: voice?.name || voiceId });
    } else {
      await api.createVoiceBinding(projectId, {
        characterAssetId,
        voiceId,
        voiceName: voice?.name || voiceId,
        language: voice?.language || 'en',
      });
    }
    onRefresh();
  };

  const handleGenerateAll = async () => {
    setGenerating(true);
    try {
      await api.generateVoices(projectId);
    } catch (e) { setErrMsg(String(e)); }
    setGenerating(false);
  };

  const getBindingForCharacter = (charId: string) => {
    return voices.find(v => (v.characterAssetId as string) === charId);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h3 className="text-sm font-semibold text-white">角色配音绑定</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfig(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              configured
                ? 'bg-green-600/20 border border-green-500/20 text-green-400'
                : 'bg-yellow-600/20 border border-yellow-500/20 text-yellow-400'
            }`}
          >
            {configured ? `TTS已配置 (${savedAppIdHint})` : '配置TTS'}
          </button>
          <button
            onClick={handleGenerateAll}
            disabled={generating || !configured || voices.length === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-all"
          >
            {generating ? '生成中...' : '批量生成配音'}
          </button>
        </div>
      </div>

      {errMsg && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {errMsg}
          <button onClick={() => setErrMsg('')} className="ml-2 text-red-400/60 hover:text-red-400">&times;</button>
        </div>
      )}

      {/* Binding List */}
      <div className="flex-1 overflow-y-auto p-4">
        {characterAssets.length > 0 ? (
          <div className="space-y-3">
            {characterAssets.map(char => {
              const binding = getBindingForCharacter(char.id as string);
              const currentVoiceId = (binding?.voiceId as string) || '';
              return (
                <div key={char.id as string} className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center text-orange-400 text-sm font-bold">
                    {(char.name as string)?.[0]}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-white">{char.name as string}</h4>
                    <p className="text-[10px] text-gray-500">{((char.metadata as Record<string, unknown>)?.gender as string) || '未知'} | {((char.metadata as Record<string, unknown>)?.age as string) || '?'}岁</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={currentVoiceId}
                      onChange={e => handleBindVoice(char.id as string, e.target.value)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white appearance-none cursor-pointer min-w-[160px]"
                    >
                      <option value="">选择音色...</option>
                      {voiceOptions.map(v => (
                        <option key={v.voiceId} value={v.voiceId}>
                          {v.name} ({v.gender}/{v.language}) {v.tags.join(',')}
                        </option>
                      ))}
                    </select>
                    {binding && (
                      <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                        {binding.voiceName as string}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            请先在资产面板提取角色
          </div>
        )}
      </div>

      {/* TTS Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowConfig(false)}>
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">配置豆包 TTS</h2>
            {configured && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/10 text-[11px] text-green-400">
                当前已配置 &middot; App ID: {savedAppIdHint} &middot; Cluster: {savedClusterId || 'volcano_tts'}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">App ID</label>
                <input
                  value={appId}
                  onChange={e => setAppId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white"
                  placeholder="火山引擎 App ID"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Access Token</label>
                <input
                  type="password"
                  value={accessToken}
                  onChange={e => setAccessToken(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white"
                  placeholder="Bearer Token"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cluster ID <span className="text-gray-600">（可选，默认 volcano_tts）</span></label>
                <input
                  value={clusterId}
                  onChange={e => setClusterId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white"
                  placeholder="volcano_tts"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowConfig(false)} className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white">取消</button>
              <button
                onClick={handleSaveConfig}
                disabled={!appId || !accessToken}
                className="px-5 py-2 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
