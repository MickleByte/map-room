/** City rules. All functions mutate a draft state. */
import type { City, GameEvent, PlayerId } from './types';

/** A city taken by an enemy unit: it changes owner, loses 1 size and its queue, and keeps its walls. */
export function captureCity(city: City, newOwner: PlayerId, events: GameEvent[]): void {
  city.owner = newOwner;
  city.size = Math.max(1, city.size - 1);
  city.queue = [];
  city.repeat = false;
  events.push({ type: 'cityCaptured', cityId: city.id, newOwner });
}
