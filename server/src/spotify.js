/**
 * Resolves Spotify track, album, or playlist metadata without needing API keys
 * by reading Spotify's public embed page (__NEXT_DATA__) with oEmbed fallback.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function parseSpotifyUrl(url) {
  const match = url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/i);
  if (!match) return null;
  return { kind: match[1].toLowerCase(), id: match[2] };
}

function formatMs(ms) {
  if (!ms || Number.isNaN(Number(ms))) return '03:30';
  const totalSec = Math.round(Number(ms) / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export async function resolveSpotify(url) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) {
    throw new Error('Enlace de Spotify no válido. Usa un enlace de canción, álbum o playlist.');
  }

  const embedUrl = `https://open.spotify.com/embed/${parsed.kind}/${parsed.id}`;
  const res = await fetch(embedUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });

  let entity = null;
  if (res.ok) {
    const html = await res.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const json = JSON.parse(nextDataMatch[1]);
        entity = json?.props?.pageProps?.state?.data?.entity || null;
      } catch {
        // Fallback below
      }
    }
  }

  // Fallback to oEmbed if embed JSON wasn't present
  if (!entity) {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!oembedRes.ok) {
      throw new Error('No se pudo leer el enlace de Spotify. Asegúrate de que sea público.');
    }
    const oembed = await oembedRes.json();
    return {
      url,
      platform: parsed.kind === 'track' ? 'Spotify' : 'Spotify Playlist',
      platformKey: 'spotify',
      title: oembed.title || 'Canción de Spotify',
      author: 'Spotify',
      duration: '03:30',
      thumbnail: oembed.thumbnail_url || '',
      defaultMode: 'audio',
      audioOnly: true,
      isPlaylist: false,
      searchQuery: `${oembed.title} official audio`,
    };
  }

  const coverImages =
    entity?.visualIdentity?.image ||
    entity?.coverArt?.sources ||
    [];
  const thumbnail = coverImages[0]?.url || '';

  if (parsed.kind === 'track') {
    const artists = (entity.artists || []).map((a) => a.name).filter(Boolean).join(', ');
    const title = entity.name || entity.title || 'Canción de Spotify';
    return {
      url,
      platform: 'Spotify',
      platformKey: 'spotify',
      title,
      author: artists || 'Spotify',
      duration: formatMs(entity.duration),
      thumbnail,
      defaultMode: 'audio',
      audioOnly: true,
      isPlaylist: false,
      searchQuery: `${artists ? artists + ' - ' : ''}${title} official audio`,
    };
  }

  // Playlist or Album
  const rawTracks = entity.trackList || [];
  const tracks = rawTracks.map((t, index) => {
    const tTitle = t.title || `Pista ${index + 1}`;
    const tArtist = t.subtitle || entity.subtitle || '';
    return {
      id: t.uri || `sp-${index}`,
      title: tTitle,
      artist: tArtist,
      duration: formatMs(t.duration),
      checked: true,
      searchQuery: `${tArtist ? tArtist + ' - ' : ''}${tTitle} official audio`,
    };
  });

  return {
    url,
    platform: parsed.kind === 'album' ? 'Spotify Álbum' : 'Spotify Playlist',
    platformKey: 'spotify',
    title: entity.name || entity.title || 'Playlist de Spotify',
    author: `${tracks.length} canciones${entity.subtitle ? ` · ${entity.subtitle}` : ''}`,
    duration: `${tracks.length} pistas`,
    thumbnail,
    defaultMode: 'audio',
    audioOnly: true,
    isPlaylist: true,
    tracks,
  };
}
