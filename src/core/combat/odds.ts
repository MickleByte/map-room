/**
 * Exact combat odds. Each combat round the attacker wins with probability
 * attack / (attack + defence) and the loser loses 1 HP; the combat ends when one side
 * reaches 0 HP. Worked out by dynamic programming over HP, with no RNG.
 */

/** The chance that the attacker destroys the defender. */
export function winChance(attack: number, defence: number, attackerHp: number, defenderHp: number): number {
  if (defenderHp <= 0) return 1;
  if (attackerHp <= 0) return 0;
  const p = roundChance(attack, defence);
  // win[d] = chance of winning with the current attacker HP against a defender on d HP.
  // Row a = 0 is all losses except d = 0.
  let prev: number[] = Array.from({ length: defenderHp + 1 }, (_, d) => (d === 0 ? 1 : 0));
  for (let a = 1; a <= attackerHp; a++) {
    const row = [1];
    for (let d = 1; d <= defenderHp; d++) row.push(p * row[d - 1]! + (1 - p) * prev[d]!);
    prev = row;
  }
  return prev[defenderHp]!;
}

/** The chance that the attacker wins a single combat round. */
export function roundChance(attack: number, defence: number): number {
  if (defence <= 0) return 1;
  return attack / (attack + defence);
}
