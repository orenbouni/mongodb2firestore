import type { ItemType, Rarity } from './types.js';

export interface CatalogItem {
  catalogId: string;
  name: string;
  itemType: ItemType;
  rarity: Rarity;
  powerRating: number;
  priceCredits: number;
  pricePlasmaCores: number;
}

/**
 * Fixed storefront used by the atomic-purchase demo. Prices are deliberately
 * spread so some buys succeed and some fail on insufficient funds.
 */
export const CATALOG: CatalogItem[] = [
  { catalogId: 'wpn_plasma_rifle_01', name: 'MK-I Plasma Rifle', itemType: 'weapon', rarity: 'Common', powerRating: 120, priceCredits: 750, pricePlasmaCores: 0 },
  { catalogId: 'wpn_ion_scattergun', name: 'Ion Scattergun', itemType: 'weapon', rarity: 'Rare', powerRating: 340, priceCredits: 2400, pricePlasmaCores: 0 },
  { catalogId: 'wpn_singularity_lance', name: 'Singularity Lance', itemType: 'weapon', rarity: 'Epic', powerRating: 610, priceCredits: 8200, pricePlasmaCores: 12 },
  { catalogId: 'wpn_void_reaper', name: 'Void Reaper', itemType: 'weapon', rarity: 'Legendary', powerRating: 910, priceCredits: 24000, pricePlasmaCores: 45 },
  { catalogId: 'arm_carbon_weave_vest', name: 'Carbon Weave Vest', itemType: 'armor', rarity: 'Common', powerRating: 95, priceCredits: 600, pricePlasmaCores: 0 },
  { catalogId: 'arm_aegis_barrier_mk3', name: 'Aegis Barrier MK-III', itemType: 'armor', rarity: 'Epic', powerRating: 580, priceCredits: 7600, pricePlasmaCores: 10 },
  { catalogId: 'arm_titanfall_exosuit', name: 'Titanfall Exosuit', itemType: 'armor', rarity: 'Legendary', powerRating: 880, priceCredits: 21000, pricePlasmaCores: 38 },
  { catalogId: 'skin_cyber_samurai', name: 'Cyber Samurai', itemType: 'skin', rarity: 'Legendary', powerRating: 50, priceCredits: 18000, pricePlasmaCores: 30 },
  { catalogId: 'skin_nebula_drifter', name: 'Nebula Drifter', itemType: 'skin', rarity: 'Epic', powerRating: 50, priceCredits: 6400, pricePlasmaCores: 8 },
  { catalogId: 'skin_crimson_vanguard', name: 'Crimson Vanguard', itemType: 'skin', rarity: 'Rare', powerRating: 50, priceCredits: 2100, pricePlasmaCores: 0 },
  { catalogId: 'con_nano_medkit', name: 'Nano Medkit', itemType: 'consumable', rarity: 'Common', powerRating: 60, priceCredits: 300, pricePlasmaCores: 0 },
  { catalogId: 'con_overdrive_stim', name: 'Overdrive Stim', itemType: 'consumable', rarity: 'Rare', powerRating: 220, priceCredits: 1500, pricePlasmaCores: 2 },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.catalogId, c]));
