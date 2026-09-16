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

async function tryDownload(routeStr, fileName) {
    if (!routeStr) return false;
    
    const filePath = path.join(iconsDir, fileName);
    if (!FORCE_UPDATE && fs.existsSync(filePath)) {
        stats.skipped++;
        return true;
    }
    
    let url;
    if (routeStr.includes('{icon}')) {
        const nameWithoutExt = fileName.replace('.png', '');
        url = routeStr.replace('{icon}', nameWithoutExt);
    } else {
        url = routeStr.endsWith('/') ? `${routeStr}${fileName}` : `${routeStr}/${fileName}`;
    }

    const res = await fetchWithRetry(url);
    
    if (res.ok) {
        fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
        stats.downloaded++;
        console.log(`Downloaded: ${fileName}`);
        return true;
    }
    return false;
}

async function tryDownloadAllRoutes(fileName) {
    const routes = [ROUTE_1, ROUTE_2, ROUTE_3, ROUTE_4];
    for (const route of routes) {
        if (!route) continue;
        if (await tryDownload(route, fileName)) return true;
    }
    return false;
}

async function downloadIcon(item) {
    const itemID = String(item.Id);
    const iconName = item.Icon ? String(item.Icon) : null;
    let success = false;

    success = await tryDownload(ROUTE_1, `${itemID}.png`);
    
    if (!success && iconName) {
        success = await tryDownload(ROUTE_1, `${iconName}.png`);
    }
    if (!success && iconName) {
        success = await tryDownload(ROUTE_2, `${iconName}.png`);
    }
    if (!success) {
        success = await tryDownload(ROUTE_3, `${itemID}.png`);
    }
    if (!success && iconName) {
        success = await tryDownload(ROUTE_3, `${iconName}.png`);
    }
    if (!success && iconName) {
        success = await tryDownload(ROUTE_4, `${iconName}.png`);
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

    success = await tryDownload(ROUTE_1, `${iconName}.png`);
    if (!success) success = await tryDownload(ROUTE_2, `${iconName}.png`);
    if (!success) success = await tryDownload(ROUTE_3, `${iconName}.png`);
    if (!success) success = await tryDownload(ROUTE_4, `${iconName}.png`);

    if (!success) {
        stats.failed++;
        stats.failedItems.push(`Banner: ${iconName}`);
        console.log(`Failed: Banner ${iconName}`);
    }
}

async function downloadCdnEntry(entry, allItems) {
    const iconName = String(entry.IconName);
    const cdnUrl = String(entry.CDNUrl);
    let success = false;

    const isTextBased = isNaN(cdnUrl) && /[a-zA-Z]/.test(cdnUrl);

    if (isTextBased) {
        const matchedItems = allItems.filter(item => {
            const iId = String(item.Id);
            const iIcon = item.Icon ? String(item.Icon) : "";
            const cleanIconName = iconName.replace(/_2$/, '');
            const cleanIIcon = iIcon.replace(/_2$/, '');
            return iId === iconName || iIcon === iconName || cleanIIcon === cleanIconName;
        });

        let anyItemSuccess = false;
        if (matchedItems.length > 0) {
            for (const matchedItem of matchedItems) {
                const itemId = String(matchedItem.Id);
                const currentSuccess = await tryDownloadAllRoutes(`${itemId}_2.png`);
                if (currentSuccess) anyItemSuccess = true;
            }
        }
        
        success = await tryDownloadAllRoutes(`${cdnUrl}.png`);
        
        if (!success) {
            success = await tryDownloadAllRoutes(`${cdnUrl.toLowerCase()}.png`);
        }

        if (anyItemSuccess) success = true;

    } else {
        success = await tryDownloadAllRoutes(`${cdnUrl}.png`);
        if (!success && /[a-zA-Z]/.test(cdnUrl)) {
            success = await tryDownloadAllRoutes(`${cdnUrl.toLowerCase()}.png`);
        }
    }

    if (!success) {
        if (!stats.failedItems.includes(cdnUrl)) {
            stats.failed++;
            stats.failedItems.push(cdnUrl);
            console.log(`Failed CDN Entry: ${cdnUrl}`);
        }
    }
}

async function start() {
    const tasks = [];
    const processedItems = new Set();
    const processedBanners = new Set();
    const processedCdn = new Set();

    let allItems = [];

    const parseDataFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        try {
            const rawData = fs.readFileSync(filePath, 'utf8');
            const items = JSON.parse(rawData);
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
            tasks.push(() => downloadCdnEntry(entry, allItems));
        }
    });

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
