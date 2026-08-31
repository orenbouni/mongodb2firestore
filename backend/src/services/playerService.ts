import type {
  DataAdapter,
  InventoryItem,
  ListPlayersOptions,
  Page,
  Player,
  PurchaseResult,
} from '../domain/types.js';

export interface PlayerProfile {
  player: Player;
  inventory: InventoryItem[];
  loadout: {
    equipped: InventoryItem[];
    totalPowerRating: number;
    legendaryCount: number;
  };
}

export async function listPlayers(adapter: DataAdapter, opts: ListPlayersOptions): Promise<Page<Player>> {
  return adapter.listPlayers(opts);
}

export async function getProfile(adapter: DataAdapter, playerId: string): Promise<PlayerProfile | null> {
  const [player, inventory] = await Promise.all([adapter.getPlayer(playerId), adapter.getInventory(playerId)]);
  if (!player) return null;

  const equipped = inventory.filter((i) => i.isEquipped);
  return {
    player,
    inventory,
    loadout: {
      equipped,
      totalPowerRating: equipped.reduce((sum, i) => sum + i.powerRating, 0),
      legendaryCount: inventory.filter((i) => i.rarity === 'Legendary').length,
    },
  };
}

export async function equipItem(
  adapter: DataAdapter,
  playerId: string,
  itemId: string,
  equip: boolean,
): Promise<InventoryItem | null> {
  return adapter.equipItem(playerId, itemId, equip);
}

export async function purchase(
  adapter: DataAdapter,
  playerId: string,
  catalogItemId: string,
): Promise<PurchaseResult> {
  return adapter.purchaseItem(playerId, catalogItemId);
}
