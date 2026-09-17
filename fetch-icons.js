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

const CONCURRENCY_LIMIT = 50;
const FORCE_UPDATE = true;

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

async function fetchFromApi(queryParams, fileName) {
    const filePath = path.join(iconsDir, `${fileName}.png`);
    if (!FORCE_UPDATE && fs.existsSync(filePath)) {
        return 'skipped';
    }

    const url = `${API_URL}/api/icons/get?${queryParams}&no_fallback=true&key=${API_KEY}`;
    
    for (let i = 0; i < 3; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
                console.log(`Downloaded: ${fileName}.png`);
                return 'downloaded';
            }
            if (res.status === 404) break;
        } catch (error) {}
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return 'failed';
}

async function downloadIcon(item) {
    const id = item.Id ? String(item.Id) : '';
    const name = item.Icon ? String(item.Icon) : '';
    const query = `type=item&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
    const result = await fetchFromApi(query, id || name);
    
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
    const query = `type=banner&name=${encodeURIComponent(name)}`;
    const result = await fetchFromApi(query, name);
    
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
            const q = `type=cdn&cdnUrl=${encodeURIComponent(itemId + '_2')}`;
            const res = await fetchFromApi(q, `${itemId}_2`);
            if (res === 'downloaded') success = true;
            if (res === 'skipped') skipFound = true;
        }
    }

    if (!success && !skipFound) {
        const q1 = `type=cdn&cdnUrl=${encodeURIComponent(cdnUrl)}`;
        const res1 = await fetchFromApi(q1, cdnUrl);
        if (res1 === 'downloaded') success = true;
        if (res1 === 'skipped') skipFound = true;
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
