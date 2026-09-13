const fs = require('fs');
const path = require('path');

const API_KEY = process.env.API_KEY;
const ROUTE_1 = process.env.ROUTE_1;
const ROUTE_2 = process.env.ROUTE_2;
const ROUTE_3 = process.env.ROUTE_3;
const ROUTE_4 = process.env.ROUTE_4;

const API_BASE_URL = 'https://kog-ff-icons-v1.vercel.app';

const liveDataPath = path.join(__dirname, 'Data', 'live', 'FF_ItemsData.json');
const advDataPath = path.join(__dirname, 'Data', 'advance', 'FFAdv_ItemsData.json');
const liveBannerPath = path.join(__dirname, 'Data', 'live', 'CollectionBanner.json');
const advBannerPath = path.join(__dirname, 'Data', 'advance', 'CollectionBanner.json');
const cdnMapPath = path.join(__dirname, 'Data', 'live', 'IconCDNMap.json');
const iconsDir = path.join(__dirname, 'ff-icons');

const CONCURRENCY_LIMIT = 150;
const FORCE_UPDATE = true;

const stats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
    failedItems: []
};

let cdnMap = [];
if (fs.existsSync(cdnMapPath)) {
    try {
        cdnMap = JSON.parse(fs.readFileSync(cdnMapPath, 'utf8'));
    } catch (error) {}
}

if (fs.existsSync(iconsDir)) {
    if (FORCE_UPDATE) {
        fs.rmSync(iconsDir, { recursive: true, force: true });
        fs.mkdirSync(iconsDir);
    }
} else {
    fs.mkdirSync(iconsDir);
}

async function fetchWithRetry(url, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url);
            if (response.status === 404) return response;
            if (response.ok) return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return { ok: false };
}

async function tryDownload(route, targetId, fileName) {
    const filePath = path.join(iconsDir, fileName);
    if (!FORCE_UPDATE && fs.existsSync(filePath)) {
        stats.skipped++;
        return true;
    }
    
    const urlPath = route === 'general' ? `/api/icon/${targetId}` : `/api/icon/${route}/${targetId}`;
    const url = `${API_BASE_URL}${urlPath}?no_fallback=true&key=${API_KEY}`;
    const res = await fetchWithRetry(url);
    
    if (res.ok) {
        fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
        stats.downloaded++;
        console.log(`Downloaded: ${fileName}`);
        return true;
    }
    return false;
}

async function downloadIcon(item) {
    const itemID = String(item.Id);
    const iconName = item.Icon ? String(item.Icon) : null;
    let success = false;

    success = await tryDownload(ROUTE_1, itemID, `${itemID}.png`);
    
    if (!success && iconName) {
        success = await tryDownload(ROUTE_1, iconName, `${iconName}.png`);
    }

    if (!success && iconName) {
        success = await tryDownload(ROUTE_2, iconName, `${iconName}.png`);
    }

    if (!success) {
        success = await tryDownload(ROUTE_3, itemID, `${itemID}.png`);
    }
    
    if (!success && iconName) {
        success = await tryDownload(ROUTE_3, iconName, `${iconName}.png`);
    }

    if (!success && iconName) {
        success = await tryDownload(ROUTE_4, iconName, `${iconName}.png`);
    }

    if (!success) {
        const cdnEntry = cdnMap.find(entry => String(entry.IconName) === itemID || (iconName && String(entry.IconName) === iconName));
        if (cdnEntry && cdnEntry.CDNUrl) {
            const cdnUrl = String(cdnEntry.CDNUrl);
            success = await tryDownload('general', cdnUrl, `${cdnUrl}.png`);
            if (!success && /[a-zA-Z]/.test(cdnUrl)) {
                success = await tryDownload('general', cdnUrl.toLowerCase(), `${cdnUrl.toLowerCase()}.png`);
            }
        }
    }

    if (!success) {
        stats.failed++;
        stats.failedItems.push(itemID);
        console.log(`Failed: ${itemID} ${iconName ? '& ' + iconName : ''}`);
    }
}

async function downloadBanner(bannerItem) {
    const iconVal = bannerItem.icon;
    if (!iconVal || String(iconVal).trim() === "") return;
    
    const iconName = String(iconVal).toLowerCase();
    let success = false;

    success = await tryDownload(ROUTE_1, iconName, `${iconName}.png`);
    if (!success) success = await tryDownload(ROUTE_2, iconName, `${iconName}.png`);
    if (!success) success = await tryDownload(ROUTE_3, iconName, `${iconName}.png`);
    if (!success) success = await tryDownload(ROUTE_4, iconName, `${iconName}.png`);

    if (!success) {
        const cdnEntry = cdnMap.find(entry => String(entry.IconName).toLowerCase() === iconName);
        if (cdnEntry && cdnEntry.CDNUrl) {
            const cdnUrl = String(cdnEntry.CDNUrl);
            success = await tryDownload('general', cdnUrl, `${cdnUrl}.png`);
            if (!success && /[a-zA-Z]/.test(cdnUrl)) {
                success = await tryDownload('general', cdnUrl.toLowerCase(), `${cdnUrl.toLowerCase()}.png`);
            }
        }
    }

    if (!success) {
        stats.failed++;
        stats.failedItems.push(`Banner: ${iconName}`);
        console.log(`Failed: Banner ${iconName}`);
    }
}

async function start() {
    const tasks = [];
    const processedItems = new Set();
    const processedBanners = new Set();

    const parseDataFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        const rawData = fs.readFileSync(filePath, 'utf8');
        const items = JSON.parse(rawData);
        const itemsArray = Array.isArray(items) ? items : Object.values(items);
        
        itemsArray.forEach(item => {
            const itemID = String(item.Id);
            if (!processedItems.has(itemID) && !(item.HideInIndex === true || !item.Icon || String(item.Icon).trim() === "")) {
                processedItems.add(itemID);
                tasks.push(() => downloadIcon(item));
            }
        });
    };

    const parseBannerFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        const rawBanner = fs.readFileSync(filePath, 'utf8');
        const banners = JSON.parse(rawBanner);
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
    };

    parseDataFile(liveDataPath);
    parseDataFile(advDataPath);

    parseBannerFile(liveBannerPath);
    parseBannerFile(advBannerPath);

    let currentIndex = 0;

    async function worker() {
        while (currentIndex < tasks.length) {
            const task = tasks[currentIndex++];
            await task();
        }
    }

    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    console.log('\n====================================');
    console.log('         DOWNLOAD SUMMARY           ');
    console.log('====================================');
    console.log(`Total Processed : ${tasks.length}`);
    console.log(`Skipped (Exists): ${stats.skipped}`);
    console.log(`Downloaded New  : ${stats.downloaded}`);
    console.log(`Failed          : ${stats.failed}`);
    
    if (stats.failedItems.length > 0) {
        console.log('------------------------------------');
        console.log('Failed Items IDs / Banners:');
        console.log(stats.failedItems.join(', '));
    }
    console.log('====================================\n');
}

start();
