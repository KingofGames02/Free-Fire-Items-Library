const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

const liveDataPath = path.join(__dirname, 'Data', 'live', 'FF_ItemsData.json');
const advDataPath = path.join(__dirname, 'Data', 'advance', 'FFAdv_ItemsData.json');
const liveBannerPath = path.join(__dirname, 'Data', 'live', 'CollectionBanner.json');
const advBannerPath = path.join(__dirname, 'Data', 'advance', 'CollectionBanner.json');
const cdnMapPath = path.join(__dirname, 'Data', 'live', 'IconCDNMap.json');
const iconsDir = path.join(__dirname, 'ff-icons');

const CONCURRENCY_LIMIT = 100;
const FORCE_UPDATE = false;

const stats = { downloaded: 0, skipped: 0, failed: 0, failedItems: [] };

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

async function fetchFromApi(queryParams, fileName, fallbackName) {
    const filePath = path.join(iconsDir, `${fileName}.png`);
    if (!FORCE_UPDATE && fs.existsSync(filePath)) {
        stats.skipped++;
        return true;
    }

    const url = `${API_URL}/api/icons/get?${queryParams}&no_fallback=true&key=${API_KEY}`;
    
    for (let i = 0; i < 3; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
                stats.downloaded++;
                console.log(`Downloaded: ${fileName}.png`);
                return true;
            }
            if (res.status === 404) break;
        } catch (error) {}
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    stats.failed++;
    stats.failedItems.push(fallbackName || fileName);
    console.log(`Failed: ${fallbackName || fileName}`);
    return false;
}

async function downloadIcon(item) {
    const id = item.Id ? String(item.Id) : '';
    const name = item.Icon ? String(item.Icon) : '';
    const query = `type=item&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
    await fetchFromApi(query, id || name, `Item: ${id} - ${name}`);
}

async function downloadBanner(bannerItem) {
    const iconVal = bannerItem.icon;
    if (!iconVal || String(iconVal).trim() === "") return;
    const name = String(iconVal);
    const query = `type=banner&name=${encodeURIComponent(name)}`;
    await fetchFromApi(query, name.toLowerCase(), `Banner: ${name}`);
}

async function downloadCdnEntry(entry) {
    const cdnUrl = String(entry.CDNUrl);
    if (!cdnUrl || cdnUrl === 'undefined') return;
    const query = `type=cdn&cdnUrl=${encodeURIComponent(cdnUrl)}`;
    await fetchFromApi(query, cdnUrl, `CDN: ${cdnUrl}`);
}

async function start() {
    if (!API_URL || !API_KEY) {
        console.error("Please set API_URL and API_KEY environment variables.");
        return;
    }

    const tasks = [];
    const processedItems = new Set();
    const processedBanners = new Set();
    const processedCdn = new Set();

    const parseDataFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        try {
            const items = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const itemsArray = Array.isArray(items) ? items : Object.values(items);
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
