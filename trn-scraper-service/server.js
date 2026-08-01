import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 7331);
const PROFILE_BASE_URL = "https://rocketleague.tracker.network/rocket-league/profile";

const PLAYLISTS = {
    10: { group: "ranked", key: "duel" },
    11: { group: "ranked", key: "double" },
    13: { group: "ranked", key: "standard" },
    27: { group: "extra", key: "hoops" },
    28: { group: "extra", key: "rumble" },
    29: { group: "extra", key: "dropshot" },
    30: { group: "extra", key: "snowday" },
};

let browserPromise;

function getBrowser() {
    if (!browserPromise) {
        browserPromise = chromium.launch({ headless: true });
    }
    return browserPromise;
}

function sendJson(response, status, payload) {
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
    });
    response.end(JSON.stringify(payload));
}

function parseRating(value) {
    if (!value) return null;
    const match = value.replace(/,/g, "").match(/\b\d{2,5}\b/);
    return match ? Number(match[0]) : null;
}

function parseDivision(value) {
    const match = (value || "").match(/Division\s+([IVX]+)/i);
    return match ? `Division ${match[1]}` : null;
}

function normalizeRow(row) {
    const playlist = PLAYLISTS[row.playlistId];
    if (!playlist) return null;

    const rating = parseRating(row.ratingText);
    const divisionName = parseDivision(row.rankText);

    return {
        group: playlist.group,
        key: playlist.key,
        value: {
            rank: {
                tier: {
                    name: row.rankName || null,
                },
                division: {
                    name: divisionName,
                },
                imageURL: row.rankImageURL || null,
            },
            mmr: rating,
            raw: row,
        },
    };
}

async function scrapeProfile(platform, username) {
    console.log(`Scraping profile of ${platform}:${username}`);
    const browser = await getBrowser();
    const page = await browser.newPage();
    console.log(`Browser opened new page`);

    try {
        const profileUrl = `${PROFILE_BASE_URL}/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/overview`;
        console.log(`Navigating to ${profileUrl}`);
        await page.goto(profileUrl, { waitUntil: "networkidle", timeout: 10000 });
        await page.waitForSelector('a[href*="playlist="]', { timeout: 10000 });

        console.log(`Extracting info from page DOM`);

        const rows = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="playlist="]'));

            return links.map((link) => {
                const href = link.getAttribute("href") || "";
                const playlistId = Number(new URL(href, location.href).searchParams.get("playlist"));
                const row = link.closest("tr") || link.closest('[role="row"]') || link.parentElement;
                const cells = row ? Array.from(row.querySelectorAll('td, [role="cell"]')).map((cell) => cell.innerText.trim()) : [];
                const image = row?.querySelector("img");
                const fullText = row?.innerText || "";

                return {
                    playlistId,
                    cells,
                    fullText,
                    rankText: cells[0] || fullText,
                    ratingText: cells[1] || fullText,
                    rankName: image?.getAttribute("alt") || image?.getAttribute("title") || null,
                    rankImageURL: image?.getAttribute("src") || null,
                };
            });
        });

        const stats = { ranked: {}, extra: {} };
        for (const row of rows) {
            const normalized = normalizeRow(row);
            if (!normalized) continue;
            stats[normalized.group][normalized.key] = normalized.value;
        }

        return {
            data: {
                platformInfo: {
                    platformSlug: platform,
                    platformUserHandle: username,
                    platformUserIdentifier: username,
                },
                stats,
                scrapedAt: new Date().toISOString(),
            },
        };
    } finally {
        await page.close();
    }
}

const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
        response.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type",
        });
        response.end();
        return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method !== "GET" || url.pathname !== "/profile") {
        sendJson(response, 404, { error: "Not found" });
        return;
    }

    const platform = (url.searchParams.get("platform") || "epic").trim();
    const username = (url.searchParams.get("username") || "").trim();

    if (!username) {
        sendJson(response, 400, { error: "username query parameter is required" });
        return;
    }

    try {
        const profile = await scrapeProfile(platform, username);
        sendJson(response, 200, profile);
    } catch (error) {
        console.error("Profile scrape failed:", error);
        sendJson(response, 500, { error: error.message || "Profile scrape failed" });
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`TRN scraper service listening on http://127.0.0.1:${PORT}`);
});

process.on("SIGINT", async () => {
    if (browserPromise) {
        const browser = await browserPromise;
        await browser.close();
    }
    process.exit(0);
});
