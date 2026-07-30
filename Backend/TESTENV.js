const axios = require('axios');
const cheerio = require('cheerio');

async function getMasterM3U8Dynamic(animeWatchUrl, targetEpisodeNum = '1') {
  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': animeWatchUrl
  };

  try {
    // 0. Dynamically fetch Anikoto's internal anime ID from the watch page HTML
    console.log(`0. Fetching anime watch page to dynamically extract internal ID: ${animeWatchUrl}`);
    const pageRes = await axios.get(animeWatchUrl, { headers: { 'User-Agent': baseHeaders['User-Agent'] } });
    const $page = cheerio.load(pageRes.data);
    
    const internalAnimeId = $page('#watch-main').attr('data-id');
    if (!internalAnimeId) {
      throw new Error('Could not dynamically extract internal data-id from the anime watch page.');
    }
    console.log('   -> Dynamically Resolved Internal Anime ID:', internalAnimeId);

    // 1. Fetch episode list using the resolved internal ID
    console.log(`\n1. Fetching episode list from /ajax/episode/list/${internalAnimeId}?vrf=...`);
    const epListRes = await axios.get(`https://anikoto.cz/ajax/episode/list/${internalAnimeId}?vrf=`, { headers: baseHeaders });
    
    const htmlData = epListRes.data.result || epListRes.data.html || epListRes.data;
    const $ep = cheerio.load(htmlData);
    
    // Find the specific episode element matching targetEpisodeNum (e.g. data-num="1" or data-slug="1")
    let epElement = $ep(`a[data-num="${targetEpisodeNum}"]`).first();
    if (!epElement.length) {
      epElement = $ep(`a[data-slug="${targetEpisodeNum}"]`).first();
    }
    if (!epElement.length) {
      epElement = $ep('a[data-ids]').first(); // Fallback to first available
    }

    const serverToken = epElement.attr('data-ids');
    const mal = epElement.attr('data-mal');
    const slug = epElement.attr('data-slug');
    const timestamp = epElement.attr('data-timestamp');

    if (!serverToken) {
      throw new Error(`Could not find data-ids token for episode ${targetEpisodeNum}.`);
    }

    console.log('\n--- EXTRACTED PARAMS FROM ANIKOTO ---');
    console.log('Target Episode Num:', targetEpisodeNum);
    console.log('data-mal:      ', mal);
    console.log('data-slug:     ', slug);
    console.log('data-timestamp:', timestamp);
    console.log('Server token extracted:', serverToken.substring(0, 30) + '...');

    // Optional / Extra: Query Nekostream API as requested to log provider download options
    if (mal && slug && timestamp) {
      try {
        const nekoUrl = `https://mapper.nekostream.site/api/mal/${mal}/${slug}/${timestamp}`;
        console.log(`\nQuerying Nekostream API: ${nekoUrl}`);
        
        const nekoRes = await axios.get(nekoUrl, {
          headers: {
            'User-Agent': baseHeaders['User-Agent'],
            'Origin': 'https://anikoto.cz',
            'Referer': animeWatchUrl
          }
        });

        console.log('Nekostream API Response:', JSON.stringify(nekoRes.data, null, 2));

        const providers = Object.keys(nekoRes.data).filter(key => key !== 'status');
        console.log('\nAvailable Providers:', providers);

        if (providers.length > 0) {
          const selectedProvider = providers[0];
          const providerData = nekoRes.data[selectedProvider];
          const downloadLink = providerData?.sub?.download?.[selectedProvider] || providerData?.dub?.download?.[selectedProvider];
          
          if (downloadLink) {
            console.log(`\nSelected Provider: "${selectedProvider}"`);
            console.log('Yoinked Target URL / Slug:', downloadLink);
          }
        }
      } catch (nekoErr) {
        console.log('   (Nekostream fallback API skipped/erred, proceeding with main stream pipeline...)');
      }
    }

    // 2. Fetch server list HTML using the giant token
    console.log('\n2. Fetching server HTML from /ajax/server/list...');
    const serverListRes = await axios.get(`https://anikoto.cz/ajax/server/list?servers=${encodeURIComponent(serverToken)}`, {
      headers: baseHeaders
    });

    const $srv = cheerio.load(serverListRes.data.result || serverListRes.data);
    
    let dataLinkId = $srv('div[data-type="dub"] li[data-sv-id="8e4"]').attr('data-link-id') ||
                     $srv('div[data-type="sub"] li[data-sv-id="8e4"]').attr('data-link-id') ||
                     $srv('li[data-link-id]').first().attr('data-link-id');

    if (!dataLinkId) {
      throw new Error('Could not find data-link-id inside server list response.');
    }

    console.log('   Yoinked Server Slug:', dataLinkId.substring(0, 35) + '...');

    // 3. Trade the slug for the VidTube embed URL
    console.log('\n3. Trading slug for VidTube URL via /ajax/server...');
    const serverRes = await axios.get(`https://anikoto.cz/ajax/server?get=${encodeURIComponent(dataLinkId)}`, {
      headers: {
        ...baseHeaders,
        'X-FP': '0e5bzbvh9uqp'
      }
    });

    const embedUrl = serverRes.data?.result?.url || serverRes.data?.url;
    if (!embedUrl) throw new Error('Anikoto rejected server lookup.');
    
    console.log('   VidTube Embed URL:', embedUrl);

    // 4. Extract numeric ID from VidTube page & fetch m3u8
    console.log('\n4. Extracting VidTube media ID and fetching .m3u8...');
    const embedRes = await axios.get(embedUrl, { headers: { 'User-Agent': baseHeaders['User-Agent'] } });
    
    const mediaIdMatch = embedRes.data.match(/data-id=["'](\d+)["']/i) || embedRes.data.match(/caPm\s*=\s*["']?(\d+)["']?/i);
    if (!mediaIdMatch) throw new Error('Could not extract media ID from VidTube HTML.');
    
    const mediaId = mediaIdMatch[1];
    console.log('   Media ID:', mediaId);

    const sourcesRes = await axios.get(`https://vidtube.site/stream/getSourcesNew?id=${mediaId}&type=dub`, {
      headers: {
        ...baseHeaders,
        'Referer': embedUrl
      }
    });

    console.log('\n================ SUCCESS! ================');
    console.log('Master M3U8 Stream URL:\n', sourcesRes.data.sources.file);
    return sourcesRes.data.sources.file;

  } catch (err) {
    console.error('\nPipeline Error:', err.message);
  }
}

// Pass any anime watch URL and episode number dynamically!
getMasterM3U8Dynamic('https://anikoto.cz/watch/the-exiled-heavy-knight-knows-how-to-game-the-system', '1');