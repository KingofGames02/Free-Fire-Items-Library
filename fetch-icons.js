const fs = require('fs');
const path = require('path');

const ROUTE_1 = process.env.ROUTE_1;
const ROUTE_2 = process.env.ROUTE_2;
const ROUTE_3 = process.env.ROUTE_3;
const ROUTE_4 = process.env.ROUTE_4;

const liveDataPath = path.join(__dirname, 'Data', 'live', 'FF_ItemsData.json');
const advDataPath = path.join(__dirname, 'Data', 'advance', 'FFAdv_ItemsData.json');
const liveBannerPath = path.join(__dirname, 'Data', 'live', 'CollectionBanner.json');
const advBannerPath = path.join(__dirname, 'Data', 'advance', 'CollectionBanner.json');
const cdnMapPath = path.join(__dirname, 'Data', 'live', 'IconCDNMap.json');
const iconsDir = path.join(__dirname, 'ff-icons');

const CONCURRENCY_LIMIT = 180;
const FORCE_UPDATE = false;

const stats = { downloaded: 0, skipped: 0, failed: 0, failedItems: [] };
let allItems = [];
let cdnMap = [];

if (fs.existsSync(cdnMapPath)) {
    try { cdnMap = JSON.parse(fs.readFileSync(cdnMapPath, 'utf8')); } catch (e) {}
}

if (fs.existsSync(iconsDir)) {
    if (FORCE_UPDATE) {
        fs.rmSync(iconsDir, { recursive: true, force: true });
        fs.mkdirSync(iconsDir);
    }
} else {
    fs.mkdirSync(iconsDir);
}

const DOMAINS = ['cdn', 'cvs', 'gmc', 'aw', 'dir', 'ak', 'tata'];
let bestDomains = ['cdn', 'aw', 'dir'];

async function findBestDomains() {
    const results = [];
    for (const d of DOMAINS) {
        const start = Date.now();
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`https://dl.${d}.freefiremobile.com/live/ABHotUpdates/IconCDN/other/101000001.png`, { method: 'HEAD', signal: controller.signal });
            clearTimeout(id);
            if (res.ok || res.status === 404) {
                results.push({ domain: d, time: Date.now() - start });
            }
        } catch (e) {}
    }
    if (results.length > 0) {
        results.sort((a, b) => a.time - b.time);
        const top = results.map(r => r.domain);
        bestDomains = [top[0] || 'cdn', top[1] || top[0] || 'aw', top[2] || top[0] || 'dir'];
    }
    console.log("Dynamically Selected Domains:", bestDomains);
}

function buildRouteUrl(routeStr, domain, val) {
    if (!routeStr) return null;
    let url = domain ? routeStr.replace(/https:\/\/dl\.[a-zA-Z0-9-]+\.freefiremobile\.com/i, `https://dl.${domain}.freefiremobile.com`) : routeStr;
    if (url.includes('{icon}')) return url.replace('{icon}', val);
    return url.endsWith('/') ? `${url}${val}.png` : `${url}/${val}.png`;
}

function buildUrlsToTry(type, id, name, cdnUrl) {
    let urls = [];
    const validId = id && id !== 'undefined' ? String(id).trim() : null;
    const validName = name && name !== 'undefined' ? String(name).trim() : null;
    const validCdn = cdnUrl && cdnUrl !== 'undefined' ? String(cdnUrl).trim() : null;

    const R = {
        '1': val => buildRouteUrl(ROUTE_1, bestDomains[0], val),
        '2': val => buildRouteUrl(ROUTE_2, null, val),
        '3': val => buildRouteUrl(ROUTE_3, bestDomains[1], val),
        '4': val => buildRouteUrl(ROUTE_4, bestDomains[2], val)
    };

    const addUrls = (val) => {
        const u1 = R['1'](val); if(u1) urls.push(u1);
        const u2 = R['2'](val); if(u2) urls.push(u2);
        const u3 = R['3'](val); if(u3) urls.push(u3);
        const u4 = R['4'](val); if(u4) urls.push(u4);
    };

    if (type === 'banner' && validName) {
        const lowerName = validName.toLowerCase();
        addUrls(validName);
        if (lowerName !== validName) addUrls(lowerName);
    } else if (type === 'cdn' && validCdn) {
        const lowerCdn = validCdn.toLowerCase();
        addUrls(validCdn);
        if (/[a-zA-Z]/.test(validCdn) && lowerCdn !== validCdn) addUrls(lowerCdn);
    } else {
        if (validId) { const u1 = R['1'](validId); if(u1) urls.push(u1); }
        if (validName) { const u1 = R['1'](validName); if(u1) urls.push(u1); }
        if (validName) { const u2 = R['2'](validName); if(u2) urls.push(u2); }
        if (validId) { const u3 = R['3'](validId); if(u3) urls.push(u3); }
        if (validName) { const u3 = R['3'](validName); if(u3) urls.push(u3); }
        if (validId) { const u4 = R['4'](validId); if(u4) urls.push(u4); }
        if (validName) { const u4 = R['4'](validName); if(u4) urls.push(u4); }
        
        if (validName) {
            const lowerName = validName.toLowerCase();
            if (lowerName !== validName) {
                const u1 = R['1'](lowerName); if(u1) urls.push(u1);
                const u2 = R['2'](lowerName); if(u2) urls.push(u2);
                const u3 = R['3'](lowerName); if(u3) urls.push(u3);
                const u4 = R['4'](lowerName); if(u4) urls.push(u4);
            }
        }
    }
    return [...new Set(urls)].filter(Boolean);
}

async function fetchWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*'
                }
            });
            if (res.ok || res.status === 404) return res;
        } catch (error) {
            if (i === maxRetries - 1) return { ok: false };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return { ok: false };
}

async function tryDownloadUrls(urls, fileName) {
    const filePath = path.join(iconsDir, `${fileName}.png`);
    if (!FORCE_UPDATE && fs.existsSync(filePath)) return 'skipped';

    for (const url of urls) {
        const res = await fetchWithRetry(url);
        if (res.ok) {
            fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
            console.log(`Downloaded: ${fileName}.png`);
            return 'downloaded';
        }
    }
    return 'failed';
}

async function downloadIcon(item) {
    const id = item.Id ? String(item.Id) : '';
    const name = item.Icon ? String(item.Icon) : '';
    const urls = buildUrlsToTry('item', id, name, null);
    
    const result = await tryDownloadUrls(urls, id || name);
    
    if (result === 'downloaded') stats.downloaded++;
    else if (result === 'skipped') stats.skipped++;
    else {
        stats.failed++;
        stats.failedItems.push(`Item: ${id} - ${name}`);
        console.log(`Failed: Item: ${id} - ${name}`);
    }
}

async function downloadBanner(bannerItem) {
    const iconVal = bannerItem.icon;
    if (!iconVal || String(iconVal).trim() === "") return;
    const name = String(iconVal);
    const urls = buildUrlsToTry('banner', null, name, null);
    
    const result = await tryDownloadUrls(urls, name.toLowerCase());
    
    if (result === 'downloaded') stats.downloaded++;
    else if (result === 'skipped') stats.skipped++;
    else {
        stats.failed++;
        stats.failedItems.push(`Banner: ${name}`);
        console.log(`Failed: Banner: ${name}`);
    }
}

async function downloadCdnEntry(entry) {
    const iconName = String(entry.IconName);
    const cdnUrl = String(entry.CDNUrl);
    if (!cdnUrl || cdnUrl === 'undefined') return;

    let success = false;
    let skipFound = false;
    const isTextBased = isNaN(cdnUrl) && /[a-zA-Z]/.test(cdnUrl);

    if (isTextBased) {
        const matchedItems = allItems.filter(item => {
            const iId = String(item.Id);
            const iIcon = item.Icon ? String(item.Icon) : "";
            const cleanIconName = iconName.replace(/_2$/, '');
            const cleanIIcon = iIcon.replace(/_2$/, '');
            return iId === iconName || iIcon === iconName || cleanIIcon === cleanIconName;
        });

        for (const matchedItem of matchedItems) {
            const itemId = String(matchedItem.Id);
            const urls = buildUrlsToTry('cdn', null, null, `${itemId}_2`);
            const res = await tryDownloadUrls(urls, `${itemId}_2`);
            if (res === 'downloaded') success = true;
            if (res === 'skipped') skipFound = true;
        }
    }

    if (!success && !skipFound) {
        const urls = buildUrlsToTry('cdn', null, null, cdnUrl);
        const res = await tryDownloadUrls(urls, cdnUrl);
        if (res === 'downloaded') success = true;
        if (res === 'skipped') skipFound = true;
    }

    if (success) stats.downloaded++;
    else if (skipFound) stats.skipped++;
    else {
        if (!stats.failedItems.some(i => i === `CDN: ${cdnUrl}`)) {
            stats.failed++;
            stats.failedItems.push(`CDN: ${cdnUrl}`);
            console.log(`Failed: CDN: ${cdnUrl}`);
        }
    }
}

async function start() {
    await findBestDomains();

    const tasks = [];
    const processedItems = new Set();
    const processedBanners = new Set();
    const processedCdn = new Set();

    const parseDataFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        try {
            const items = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const itemsArray = Array.isArray(items) ? items : Object.values(items);
            
            allItems = allItems.concat(itemsArray);

            itemsArray.forEach(item => {
                const itemID = String(item.Id);
                if (!processedItems.has(itemID) && !(item.HideInIndex === true || !item.Icon || String(item.Icon).trim() === "")) {
                    processedItems.add(itemID);
                    tasks.push(() => downloadIcon(item));
                }
            });
        } catch (e) {}
    };

    const parseBannerFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        try {
            const banners = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const bannerArray = Array.isArray(banners) ? banners : Object.values(banners);
            bannerArray.forEach(banner => {
                const iconVal = banner.icon;
                if (iconVal && String(iconVal).trim() !== "") {
                    const iconName = String(iconVal).toLowerCase();
                    if (!processedBanners.has(iconName)) {
                        processedBanners.add(iconName);
                        tasks.push(() => downloadBanner(banner));
                    }
                }
            });
        } catch (e) {}
    };

    parseDataFile(liveDataPath);
    parseDataFile(advDataPath);
    parseBannerFile(liveBannerPath);
    parseBannerFile(advBannerPath);

    cdnMap.forEach(entry => {
        const cdnUrl = String(entry.CDNUrl);
        if (cdnUrl && !processedCdn.has(cdnUrl)) {
            processedCdn.add(cdnUrl);
            tasks.push(() => downloadCdnEntry(entry));
        }
    });

    let currentIndex = 0;
    async function worker() {
        while (currentIndex < tasks.length) {
            const task = tasks[currentIndex++];
            await task();
        }
    }

    const workers = Array.from({ length: CONCURRENCY_LIMIT }, () => worker());
    await Promise.all(workers);

    console.log('\n====================================');
    console.log(`Total Processed : ${tasks.length}`);
    console.log(`Downloaded New  : ${stats.downloaded}`);
    console.log(`Skipped (Exists): ${stats.skipped}`);
    console.log(`Failed          : ${stats.failed}`);
    if (stats.failedItems.length > 0) {
        console.log('Failed Items:');
        console.log(stats.failedItems.join(', '));
    }
    console.log('====================================\n');
}

start();
