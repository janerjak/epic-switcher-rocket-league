import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox } from "playwright";
import {} from "./utils.js";

Array.prototype.randomElement = function () {
    return this[Math.floor(Math.random() * this.length)];
};

const PROFILE_BASE_URL = "https://rocketleague.tracker.network/rocket-league/profile";
const PORT = Number(process.env.PORT || 7331);
const BROWSER = (process.env.PLAYWRIGHT_BROWSER || "firefox").toLowerCase();
const DEBUG_DIR = path.resolve("debug");

const ROCKET_LEAGUE_PLAYLISTS = {
    10: { group: "ranked", name: "duel" },
    11: { group: "ranked", name: "double" },
    13: { group: "ranked", name: "standard" },
    27: { group: "extra", name: "hoops" },
    28: { group: "extra", name: "rumble" },
    29: { group: "extra", name: "dropshot" },
    30: { group: "extra", name: "snowday" },
};

let browserPromise;

function buildBrowserPromise() {
    if (!browserPromise) {
        const playwrightBrowser = {
            firefox: firefox,
            chromium: chromium,
        }[BROWSER];
        browserPromise = playwrightBrowser.launch({
            headless: Boolean(process.env.HEADLESS) ?? true,
            slowMo: Number(process.env.SCRAPING_SLOWMO || 0),
        });
    }
    return browserPromise;
}

async function writeDebugFiles(page, username, stage) {
    if (!process.env.SCRAPING_DEBUG) return;

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

function parseMmr(compactCells) {
    // ^(\d+)               -> Start with one or more digits (Group 1)
    // (?:                  -> Start a non-capturing group for the optional part
    //   \s+                -> Match optional whitespace (includes \n)
    //   (Top|Bottom)       -> Match either "Top" or "Bottom" (Group 2)
    //   \s*                -> Match optional whitespace
    //   ([\d.]+%?)         -> Match digits and dots, and an optional % sign (Group 3)
    // )?                   -> Make the entire second group optional
    // $                    -> End of string
    // Flag 'i'             -> Case-insensitive (handles "top", "TOP", etc.)

    function extractMmrFromCell(cell) {
        if (!cell) return null;
        const mmrPattern = /^([\d,.]+)(?:\s*(Top|Bottom)\s*([\d.]+%?))?$/i;
        const matches = cell.match(mmrPattern);
        if (!matches) return null;
        const [_, mmr, topOrBottom, topOrBottomPercentage] = matches;
        const cleanedMmr = mmr.replace(",", "").replace(".", "");
        return { mmr: Number(cleanedMmr), topOrBottom, topOrBottomPercentage };
    }

    const expectedMmrCellIndex = 1;
    const expectedCellResult = extractMmrFromCell(compactCells.at(expectedMmrCellIndex));
    if (expectedCellResult) return expectedCellResult;

    for (const [index, cell] of compactCells.entries()) {
        if (index == expectedMmrCellIndex) continue;
        const extractedFromCell = extractMmrFromCell(cell);
        if (extractMmrFromCell) return extractedFromCell;
    }
    return null;
}

function parseDivision(value) {
    const match = (value || "").match(/Division\s+([IVX]+)/i);
    return match ? `Div ${match[1]}` : null;
}

function parseExtraData(compactCells, mmrData) {
    function parseMatchCounts(cell) {
        const matchesAndWinStreakPattern = /^(\d+)(?:\s+(Win|Loss) Strk\.\s+([\d.]+))?$/i;
        const matches = cell?.match(matchesAndWinStreakPattern);
        if (matches) {
            const [_, playedMatchCount, winOrLossStreak, streakMatchCount] = matches;
            return { playedMatchCount: Number(playedMatchCount), winOrLossStreak, streakMatchCount: Number(streakMatchCount) };
        }
        return null;
    }
    try {
        const potentialPeakMmr = Number(compactCells[4]);
        const peakMmr = potentialPeakMmr >= (mmrData?.mmr ?? 0) ? potentialPeakMmr : null;
        return { peakMmr, matchCounts: parseMatchCounts(compactCells.at(5)) };
    } catch (ex) {
        console.error(`Error during extra data parsing on ${compactCells} (with mmr data ${mmrData})`, ex);
        return null;
    }
}

function normalizeRow(row) {
    const playlist = ROCKET_LEAGUE_PLAYLISTS[row.playlistId];
    if (!playlist) return null;

    const divisionName = parseDivision(row.rankText);
    const mmrData = parseMmr(row.compactCells);
    const extraData = parseExtraData(row.compactCells, mmrData);

    return {
        playlistGroup: playlist.group,
        playlistName: playlist.name,
        playlistData: {
            rank: {
                tier: {
                    name: row.rankName || null,
                },
                division: {
                    name: divisionName,
                },
                imageURL: row.rankImageURL || null,
            },
            mmr: mmrData?.mmr,
            mmrData,
            extraData,
            rawCellData: row,
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
    const browser = await buildBrowserPromise();
    const context = await browser.newContext({
        locale: "en-US",
        userAgent: [
            //"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            //"AppleWebKit/537.36 (KHTML, like Gecko)",
            "Chrome/121.0.0.0 (Windows NT 10.0; Win64; x64)",
            //"Safari/537.36",
        ].randomElement(),
        viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    console.log(`Browser opened new page`);

    try {
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(10000);

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
            stats[normalized.playlistGroup][normalized.playlistName] = normalized.playlistData;
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

async function loadSettingsFile(filePath, exitOnError = true) {
    try {
        const loadedSettings = JSON.parse(await fs.readFile(filePath, "utf8"));
        Object.entries(loadedSettings).forEach(([key, value]) => {
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        });
    } catch (ex) {
        console.error(`Could not load settings file ${filePath}`, ex);
        if (exitOnError) {
            process.exit(1);
        }
    }
}

await loadSettingsFile("settings.json");

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
