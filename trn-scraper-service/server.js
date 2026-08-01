import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox } from "playwright";

async function loadEnvFile(filePath) {
    try {
        const text = await fs.readFile(filePath, "utf8");
        for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;

            const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
            const eqIndex = cleaned.indexOf("=");
            if (eqIndex === -1) continue;

            const key = cleaned.slice(0, eqIndex).trim();
            let value = cleaned.slice(eqIndex + 1).trim();
            value = value.replace(/^['\"]|['\"]$/g, "");

            if (key && process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
    } catch {
        // Optional env file.
    }
}

await loadEnvFile(".env");
await loadEnvFile(".env.local");

const PORT = Number(process.env.PORT || 7331);
const PROFILE_BASE_URL = "https://rocketleague.tracker.network/rocket-league/profile";
const BROWSER = (process.env.TRN_BROWSER || "chromium").toLowerCase();
const DEBUG = process.env.TRN_DEBUG === "1";
const HEADLESS = process.env.TRN_HEADFUL === "1" ? false : true;
const DEBUG_DIR = path.resolve("debug");

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
        const browserType = BROWSER === "firefox" ? firefox : chromium;
        browserPromise = browserType.launch({
            headless: HEADLESS,
            slowMo: Number(process.env.TRN_SLOWMO || 0),
        });
    }
    return browserPromise;
}

async function writeDebugFiles(page, username, stage) {
    if (!DEBUG) return;

    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const safeUsername = username.replace(/[^a-z0-9_-]/gi, "_");
    const base = path.join(DEBUG_DIR, `${Date.now()}-${safeUsername}-${stage}`);

    await fs.writeFile(`${base}.html`, await page.content(), "utf8").catch(() => {});
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    console.log(`Wrote scraper debug files: ${base}.html and ${base}.png`);
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
    return match ? `Div ${match[1]}` : null;
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

async function waitForProfileContent(page) {
    const waits = [
        page.waitForSelector('a[href*="playlist="]', { timeout: 45000 }),
        page.waitForFunction(() => document.body?.innerText?.includes("Ranked Doubles 2v2"), null, { timeout: 45000 }),
    ];

    const results = await Promise.allSettled(waits);
    if (results.some((result) => result.status === "fulfilled")) {
        return;
    }

    throw results[0].reason || new Error("Profile content did not load");
}

async function scrapeProfile(platform, username) {
    console.log(`Scraping profile of ${platform}:${username}`);
    const browser = await getBrowser();
    const context = await browser.newContext({
        locale: "en-US",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    console.log(`Browser opened new page`);

    try {
        page.setDefaultTimeout(45000);
        page.setDefaultNavigationTimeout(45000);

        await page.route("**/*", (route) => {
            const request = route.request();
            const resourceType = request.resourceType();
            const requestUrl = request.url();

            if (["media", "font"].includes(resourceType)) {
                route.abort();
                return;
            }

            if (/nitropay|primis|doubleclick|googlesyndication|adservice|adsrvr|pubmatic|rubiconproject/i.test(requestUrl)) {
                route.abort();
                return;
            }

            route.continue();
        });

        const profileUrl = `${PROFILE_BASE_URL}/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/overview`;
        console.log(`Navigating to ${profileUrl}`);
        try {
            const navigation = await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            console.log(`Navigation completed with status ${navigation?.status() ?? "unknown"}`);
        } catch (error) {
            console.warn(`Navigation did not fully complete, checking page content anyway: ${error.message}`);
        }

        await waitForProfileContent(page);

        console.log(`Extracting info from page DOM`);

        const rows = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="playlist="]'));

            return links.map((link) => {
                const href = link.getAttribute("href") || "";
                const playlistId = Number(new URL(href, location.href).searchParams.get("playlist"));
                const row = link.closest("tr") || link.closest('[role="row"]') || link.parentElement;
                const cells = row ? Array.from(row.querySelectorAll('td, [role="cell"]')).map((cell) => cell.innerText.trim()) : [];
                const compactCells = cells.filter(Boolean);
                const image = row?.querySelector("img");
                const fullText = row?.innerText || "";
                const ratingCell = compactCells.slice(1).find((cell) => /^\d[\d,]*$/.test(cell)) || compactCells[1] || fullText;

                return {
                    playlistId,
                    cells,
                    compactCells,
                    fullText,
                    rankText: compactCells[0] || fullText,
                    ratingText: ratingCell,
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
    } catch (error) {
        await writeDebugFiles(page, username, "failed");
        throw error;
    } finally {
        await context.close();
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

await loadEnvFile(".env");
await loadEnvFile(".env.local");

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
