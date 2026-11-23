import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import { thumbnailProxyUrl } from '../lib/api';
import { SFX } from '../lib/sfx';

export default function HistoryStack({
  items,
  filter,
  onFilterChange,
  onClearAll,
  onRemoveItem,
  onRedownload,
}) {
  const filtered = items.filter((item) => filter === 'all' || item.type === filter);

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-4 px-1">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold tracking-tight">Historial</h2>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full glass-pill text-muted tabular-nums">
            {items.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'audio', label: 'Audio' },
              { id: 'video', label: 'Vídeo' },
            ].map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    SFX.tick();
                    onFilterChange(f.id);
                  }}
                  className={`tactile px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer ${
                    active
                      ? 'bg-[#FF3D6E]/15 text-[#FF3D6E] border border-[#FF3D6E]/30'
                      : 'text-muted hover:text-soft'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                SFX.remove();
                onClearAll();
              }}
              className="tactile text-xs text-muted hover:text-[#FF3D6E] ml-2 cursor-pointer"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-surface rounded-[24px] p-8 text-center">
          <p className="text-sm text-muted">
            {items.length === 0
              ? 'Tus descargas aparecerán apiladas aquí abajo.'
              : 'No hay descargas en esta categoría.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const thumb = item.thumbnail ? thumbnailProxyUrl(item.thumbnail) : '';
            const shortBadge = (item.format || 'MP3').split('·')[0].trim();
            return (
              <div
                key={item.id}
                onMouseMove={handleMouseMove}
                className="glass-surface glass-interactive rounded-[22px] p-3.5 sm:p-4 flex items-center gap-3.5 sm:gap-4 group animate-stack-pop"
              >
                {/* Artwork */}
                <div
                  className="relative w-13 h-13 sm:w-14 sm:h-14 rounded-[15px] shrink-0 overflow-hidden flex items-center justify-center shadow-lg"
                  style={{
                    width: 54,
                    height: 54,
                    background: 'linear-gradient(135deg, #191922 0%, #4b182c 55%, #FF3D6E 100%)',
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] font-bold tracking-wider text-white/90 group-hover:opacity-0 transition-opacity">
                      {shortBadge}
                    </span>
                  )}
                  <div className="playing absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                  </div>
                </div>

                {/* Meta */}
                <div className="flex-1 min-w-0 relative z-10">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium truncate">{item.title}</h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted mt-0.5">
                    <span className="truncate">{item.author}</span>
                    <span>·</span>
                    <span className="text-[#FF3D6E]/90 font-medium">{item.format}</span>
                    {item.size && (
                      <>
                        <span className="hidden sm:inline">·</span>
                        <span className="hidden sm:inline tabular-nums">{item.size}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 relative z-10 shrink-0">
                  {item.url && (
                    <button
                      type="button"
                      onClick={() => {
                        SFX.tap();
                        onRedownload(item.url);
                      }}
                      className="glass-pill tactile p-2 rounded-xl text-muted hover:text-[#FF3D6E] cursor-pointer"
                      title="Cargar enlace de nuevo"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      SFX.remove();
                      onRemoveItem(item.id);
                    }}
                    className="glass-pill tactile p-2 rounded-xl text-muted hover:text-[#FF3D6E] cursor-pointer"
                    title="Quitar del historial"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
