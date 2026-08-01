import { GetRocketLeagueProfile } from '../../wailsjs/go/services/RocketLeagueService';

export const TRN_RL_MODES = [
  { value: 'duel', label: '1v1', aliases: ['duel', '1v1', 'solo', 'solos'] },
  { value: 'double', label: '2v2', aliases: ['double', 'doubles', '2v2'] },
  { value: 'standard', label: '3v3', aliases: ['standard', 'trio', 'trios', '3v3'] },
];

export function getTrnModeLabel(mode) {
  return TRN_RL_MODES.find((item) => item.value === mode)?.label || mode;
}

export async function fetchRocketLeagueProfile(username, platform = 'epic') {
  const raw = await GetRocketLeagueProfile(username, platform);
  return JSON.parse(raw);
}

function getByPath(object, path) {
    return path.split(".").reduce((value, key) => (value ? value[key] : undefined), object);
}

function normalizeRankBlock(block) {
    if (!block) return null;

    const rank = block.rank || block.seasonRank || {};
    const tier = rank.tier || block.tier || {};
    const division = rank.division || block.division || {};

    return {
        rankName: tier.name || rank.name || block.rankName || null,
        divisionName: division.name || block.divisionName || null,
        mmr: block.mmr ?? rank.mmr ?? block.rating ?? block.rankRating ?? null,
        imageURL: rank.imageURL || block.imageURL || tier.imageURL || null,
        raw: block,
    };
}

function matchesMode(text, mode) {
    const target = (text || "").toString().toLowerCase();
    return TRN_RL_MODES.find((item) => item.value === mode)?.aliases.some((alias) => target.includes(alias)) || false;
}

export function extractTrnModeStats(profileResponse, mode) {
    const root = profileResponse?.data || profileResponse || {};

    const nestedCandidates = [`stats.ranked.${mode}`, `stats.ranked.${mode}s`, `stats.${mode}`, `ranked.${mode}`, `ranked.${mode}s`];

    for (const path of nestedCandidates) {
        const block = getByPath(root, path);
        const normalized = normalizeRankBlock(block);
        if (normalized?.mmr != null || normalized?.imageURL || normalized?.rankName || normalized?.divisionName) {
            return normalized;
        }
    }

    const segments = root.segments || root.stats?.segments || [];
    const segment = segments.find((item) => {
        const descriptor = [
            item?.metadata?.name,
            item?.metadata?.label,
            item?.metadata?.title,
            item?.attributes?.playlist,
            item?.attributes?.mode,
            item?.type,
        ]
            .filter(Boolean)
            .join(" ");

        return matchesMode(descriptor, mode);
    });

    if (!segment) return null;

    const stats = segment.stats || segment.data || segment;
    return normalizeRankBlock(stats);
}
