import React from 'react';
import { Link2 } from 'lucide-react';

export function detectPlatformKey(url = '') {
  const u = url.toLowerCase();
  if (u.includes('youtube') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('spotify')) return 'spotify';
  if (u.includes('soundcloud')) return 'soundcloud';
  if (u.includes('tiktok')) return 'tiktok';
  if (u.includes('instagram')) return 'instagram';
  return 'generic';
}

export default function PlatformIcon({ platformKey, className = 'w-5 h-5' }) {
  if (platformKey === 'youtube') {
    return (
      <svg className={`${className} text-[#FF3D6E]`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />
      </svg>
    );
  }
  if (platformKey === 'spotify') {
    return (
      <svg className={`${className} text-[#FF3D6E]`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm4.6 14.4a.75.75 0 0 1-1 .25c-2.8-1.7-6.3-2.1-10.5-1.15a.75.75 0 1 1-.33-1.46c4.6-1.05 8.5-.6 11.6 1.3a.75.75 0 0 1 .23 1.06zm1.2-2.7a.94.94 0 0 1-1.3.3c-3.2-1.96-8.1-2.53-11.9-1.38a.94.94 0 0 1-.55-1.8c4.34-1.32 9.72-.68 13.4 1.58a.94.94 0 0 1 .35 1.3zm.1-2.8C14.1 8.65 7.8 8.44 4.16 9.55a1.12 1.12 0 1 1-.65-2.15c4.2-1.27 11.16-1.02 15.56 1.6a1.12 1.12 0 1 1-1.15 1.9z" />
      </svg>
    );
  }
  if (platformKey === 'soundcloud') {
    return (
      <svg className={`${className} text-[#FF3D6E]`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.5 7.5a5 5 0 0 1 4.9 4h.6a3 3 0 0 1 0 6H9.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h2zM5.5 11.5a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0v-4a1 1 0 0 1 1-1zm-3 2a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1z" />
      </svg>
    );
  }
  if (platformKey === 'tiktok') {
    return (
      <svg className={`${className} text-[#FF3D6E]`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.6 6.7a4.8 4.8 0 0 1-3.8-4.7h-3.3v13.2a2.7 2.7 0 1 1-2.7-2.7c.3 0 .6 0 .9.1V9.2a6 6 0 1 0 5.1 6V8.5a8.1 8.1 0 0 0 3.8 1V6.7z" />
      </svg>
    );
  }
  if (platformKey === 'instagram') {
    return (
      <svg className={`${className} text-[#FF3D6E]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return <Link2 className={`${className} text-muted`} />;
}
