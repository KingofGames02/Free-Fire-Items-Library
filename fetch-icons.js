const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'ItemsData_en.json');
const bannerPath = path.join(__dirname, 'CollectionBanner.json');
const iconsDir = path.join(__dirname, 'ff-icons');
const ignoreListPath = path.join(__dirname, 'ignore_list.json');
const CONCURRENCY_LIMIT = 150;
const FORCE_UPDATE = false;

const stats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
    ignoredFull: 0,
    failedItems: []
};

let ignoreData = { ignore_update: [], ignore_all: [] };
if (fs.existsSync(ignoreListPath)) {
    try {
        const rawIgnoreData = fs.readFileSync(ignoreListPath, 'utf8');
        const parsed = JSON.parse(rawIgnoreData);
        if (parsed.ignore_update) ignoreData.ignore_update = parsed.ignore_update.map(String);
        if (parsed.ignore_all) ignoreData.ignore_all = parsed.ignore_all.map(String);
    } catch (error) {
        console.error('Error reading ignore_list.json:', error.message);
    }
}

if (fs.existsSync(iconsDir)) {
    if (FORCE_UPDATE) {
        fs.rmSync(iconsDir, { recursive: true, force: true });
        fs.mkdirSync(iconsDir);
        console.log('Cleaned ff-icons folder.');
    }
} else {
    fs.mkdirSync(iconsDir);
}

async function fetchWithRetry(url, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url);
            if (response.status === 404) {
                return response;
            }
            if (response.ok) {
                return response;
            }
        } catch (error) {
            if (i === maxRetries - 1) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return { ok: false };
}

async function downloadIcon(item) {
    const itemID = String(item.itemID);
    const iconName = item.icon ? (item.isBanner ? String(item.icon).toLowerCase() : String(item.icon)) : null;
    
    const isAllIgnored = ignoreData.ignore_all.includes(itemID) || (iconName && ignoreData.ignore_all.includes(iconName));
    const isUpdateIgnored = ignoreData.ignore_update.includes(itemID) || (iconName && ignoreData.ignore_update.includes(iconName));

    if (isAllIgnored) {
        stats.ignoredFull++;
        return;
    }

    let mainIconFound = false;

    const targetId = { id: itemID, file: `${itemID}.png` };
    const pathId = path.join(iconsDir, targetId.file);
    
    if (!FORCE_UPDATE && fs.existsSync(pathId)) {
        stats.skipped++;
        mainIconFound = true;
    } else {
        const url1 = `https://kog-ff-icons.vercel.app/api/icon/${targetId.id}?no_fallback=true`;
        let res1 = await fetchWithRetry(url1);
        if (res1.ok) {
            fs.writeFileSync(pathId, Buffer.from(await res1.arrayBuffer()));
            stats.downloaded++;
            console.log(`Downloaded: ${targetId.file}`);
            mainIconFound = true;
        }
    }

    if (!mainIconFound && iconName) {
        const targetIcon = { id: iconName, file: `${iconName}.png` };
        const pathIcon = path.join(iconsDir, targetIcon.file);

        if (!FORCE_UPDATE && fs.existsSync(pathIcon)) {
            stats.skipped++;
            mainIconFound = true;
        } else {
            const urlIcon = `https://kog-ff-icons.vercel.app/api/icon/${targetIcon.id}?no_fallback=true`;
            let resIcon = await fetchWithRetry(urlIcon);
            if (resIcon.ok) {
                fs.writeFileSync(pathIcon, Buffer.from(await resIcon.arrayBuffer()));
                stats.downloaded++;
                console.log(`Downloaded: ${targetIcon.file}`);
                mainIconFound = true;
            }
        }
    }

    if (!mainIconFound) {
        stats.failed++;
        stats.failedItems.push(itemID);
        console.log(`Failed: ${itemID} ${iconName ? '& ' + iconName : ''}`);
    }

    if (!isUpdateIgnored) {
        const targetId2 = { id: `${itemID}_2`, file: `${itemID}_2.png` };
        const pathId2 = path.join(iconsDir, targetId2.file);
        
        if (!FORCE_UPDATE && fs.existsSync(pathId2)) {
            stats.skipped++;
        } else {
            const url2 = `https://kog-ff-icons.vercel.app/api/icon/${targetId2.id}?no_fallback=true`;
            let res2 = await fetchWithRetry(url2);
            if (res2.ok) {
                fs.writeFileSync(pathId2, Buffer.from(await res2.arrayBuffer()));
                stats.downloaded++;
                console.log(`Downloaded: ${targetId2.file}`);
            }
        }
    }
}

async function start() {
    let validItems = [];

    if (fs.existsSync(dataPath)) {
        const rawData = fs.readFileSync(dataPath, 'utf8');
        const items = JSON.parse(rawData);
        const itemsArray = Array.isArray(items) ? items : Object.values(items);
        validItems = validItems.concat(itemsArray.filter(item => !(item.hideInIndex === true || !item.icon || item.icon.trim() === "")));
    }

    if (fs.existsSync(bannerPath)) {
        const rawBanner = fs.readFileSync(bannerPath, 'utf8');
        const banners = JSON.parse(rawBanner);
        const bannerArray = Array.isArray(banners) ? banners : Object.values(banners);
        validItems = validItems.concat(bannerArray.filter(item => item.icon && item.icon.trim() !== "").map(item => ({ ...item, isBanner: true })));
    }

    let currentIndex = 0;

    async function worker() {
        while (currentIndex < validItems.length) {
            const item = validItems[currentIndex++];
            await downloadIcon(item);
        }
    }

    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    const allFiles = fs.readdirSync(iconsDir);
    const updatedIcons = allFiles
        .filter(file => file.endsWith('_2.png'))
        .map(file => file.replace('_2.png', ''))
        .filter(id => !ignoreData.ignore_update.includes(id) && !ignoreData.ignore_all.includes(id));
    
    fs.writeFileSync(path.join(__dirname, 'updated_icons.json'), JSON.stringify(updatedIcons));

    console.log('\n====================================');
    console.log('         DOWNLOAD SUMMARY           ');
    console.log('====================================');
    console.log(`Total Processed : ${validItems.length}`);
    console.log(`Fully Ignored   : ${stats.ignoredFull}`);
    console.log(`Skipped (Exists): ${stats.skipped}`);
    console.log(`Downloaded New  : ${stats.downloaded}`);
    console.log(`Failed          : ${stats.failed}`);
    console.log(`Updated Icons Detected & Saved: ${updatedIcons.length}`);
    
    if (stats.failedItems.length > 0) {
        console.log('------------------------------------');
        console.log('Failed Items IDs:');
        console.log(stats.failedItems.join(', '));
    }
    console.log('====================================\n');
}

start();
