// Cloudflare Worker for Kwik.cx & AnimePahe Direct MP4 / M3U8 Extraction
// Deploy this to Cloudflare Workers (e.g. your workers.dev subdomain)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    if (!path) {
      return new Response(JSON.stringify({ ok: false, error: 'Usage: /<pahe_id> or /f/<kwik_token> or /e/<kwik_token>' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      let kwikToken = path;
      let isEmbed = false;

      // 1. If given a full pahe shortlink ID (like oXweW)
      if (!path.startsWith('f/') && !path.startsWith('e/')) {
        const redirectRes = await fetch(`https://proud-dew-d754.download992.workers.dev/${path}`, {
          redirect: 'manual'
        });
        const loc = redirectRes.headers.get('location');
        if (loc) {
          const match = loc.match(/kwik\.cx\/(?:f|e)\/([a-zA-Z0-9_-]+)/);
          if (match) kwikToken = match[1];
        }
      } else {
        if (path.startsWith('e/')) isEmbed = true;
        kwikToken = path.replace(/^[fe]\//, '');
      }

      // 2. Fetch the kwik page with valid headers from Cloudflare edge
      const kwikUrl = `https://kwik.cx/${isEmbed ? 'e' : 'f'}/${kwikToken}`;
      const kwikRes = await fetch(kwikUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://animepahe.si/'
        }
      });

      const html = await kwikRes.text();
      const cookie = kwikRes.headers.get('set-cookie')?.split(';')[0] || '';

      // 3. Check for Dean Edwards packed m3u8 script (embed page)
      const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
      let streamUrl = null;
      if (packedMatch) {
        const unpacked = unpackJs(packedMatch[0]);
        if (unpacked) {
          const m3u8Match = unpacked.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
          if (m3u8Match) streamUrl = m3u8Match[0];
        }
      }

      // 4. Check for direct download MP4 form (download page)
      let directMp4Url = null;
      const obfuscatedParams = html.match(/\}\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (obfuscatedParams) {
        const formScript = deobfuscate(
          obfuscatedParams[1],
          obfuscatedParams[2],
          Number(obfuscatedParams[3]),
          Number(obfuscatedParams[4])
        );
        const actionMatch = formScript.match(/action="([^"]+)"/);
        const tokenMatch = formScript.match(/name="_token"\s+value="([^"]+)"/);

        if (actionMatch && tokenMatch) {
          const formAction = actionMatch[1];
          const postToken = tokenMatch[1];
          
          const formData = new URLSearchParams();
          formData.append('_token', postToken);

          const formRes = await fetch(formAction, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': kwikUrl,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Cookie': cookie
            },
            body: formData.toString(),
            redirect: 'manual'
          });

          if (formRes.status === 302 || formRes.status === 301) {
            directMp4Url = formRes.headers.get('location');
          }
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        token: kwikToken,
        kwikUrl,
        directMp4Url,
        streamUrl: streamUrl || directMp4Url,
        isM3u8: !!streamUrl
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};

function deobfuscate(payload, key, offset, radix) {
  let result = '';
  const delimiter = key[radix];
  const chunks = payload.split(delimiter);
  const map = {};
  for (let i = 0; i < key.length; i++) {
    map[key[i]] = i;
  }
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    let val = 0;
    for (let i = 0; i < chunk.length; i++) {
      val = val * radix + map[chunk[i]];
    }
    result += String.fromCharCode(val - offset);
  }
  try {
    return decodeURIComponent(escape(result));
  } catch {
    return result;
  }
}

function unpackJs(packed) {
  const match = packed.match(/}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split\(['"]\|['"]\)/s);
  if (!match) return null;
  let [_, p, a, c, k] = match;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  const words = k.split('|');
  const e = (c) => (c < a ? '' : e(parseInt(c / a, 10))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  while (c--) {
    if (words[c]) {
      p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), words[c]);
    }
  }
  return p;
}
