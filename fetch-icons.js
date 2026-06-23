const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'ItemsData_en.json');
const iconsDir = path.join(__dirname, 'ff-icons');
const CONCURRENCY_LIMIT = 120;
const FORCE_UPDATE = true;

const stats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
    failedItems: []
};

if (!fs.existsSync(iconsDir)) {
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
    const itemID = item.itemID;
    const iconName = item.icon;
    
    const targets = [
        { id: itemID, file: `${itemID}.png` },
        { id: `${itemID}_2`, file: `${itemID}_2.png` }
    ];

    if (iconName) {
        targets.push({ id: iconName, file: `${iconName}.png` });
    }

    let isAnyDownloaded = false;

    for (const target of targets) {
        const savePath = path.join(iconsDir, target.file);

        if (!FORCE_UPDATE && fs.existsSync(savePath)) {
            stats.skipped++;
            isAnyDownloaded = true;
            continue;
        }

        const url = `https://kog-ff-icons.vercel.app/api/icon/${target.id}?no_fallback=true`;

        try {
            const response = await fetchWithRetry(url);
            
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                fs.writeFileSync(savePath, Buffer.from(buffer));
                stats.downloaded++;
                console.log(`Downloaded: ${target.file}`);
                isAnyDownloaded = true;
            }
        } catch (error) {
            console.error(`Error ${target.id}:`, error.message);
        }
    }

    if (!isAnyDownloaded) {
        stats.failed++;
        stats.failedItems.push(itemID);
        console.log(`Failed: ${itemID} ${iconName ? '& ' + iconName : ''}`);
    }
}

async function start() {
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const items = JSON.parse(rawData);
    
    const itemsArray = Array.isArray(items) ? items : Object.values(items);
    const validItems = itemsArray.filter(item => !(item.hideInIndex === true || !item.icon || item.icon.trim() === ""));

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

    console.log('\n====================================');
    console.log('         DOWNLOAD SUMMARY           ');
    console.log('====================================');
    console.log(`Total Processed : ${validItems.length}`);
    console.log(`Skipped (Exists): ${stats.skipped}`);
    console.log(`Downloaded New  : ${stats.downloaded}`);
    console.log(`Failed          : ${stats.failed}`);
    
    if (stats.failedItems.length > 0) {
        console.log('------------------------------------');
        console.log('Failed Items IDs:');
        console.log(stats.failedItems.join(', '));
    }
    console.log('====================================\n');
}

start();
