const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function exactTrackAssignment(candidates, stateBudget = 250000) {
  const keys = [...new Set(candidates.flatMap((candidate) => candidate.fix.node_tracks))].sort(lexical);
  const bits = new Map(keys.map((key, index) => [key, 1n << BigInt(index)]));
  const proposals = candidates.map((candidate, index) => ({
    ...candidate,
    index,
    mask: candidate.fix.node_tracks.reduce((mask, key) => mask | bits.get(key), 0n)
  }));
  const memo = new Map();
  const solve = (remaining) => {
    if (!remaining) return { utility: 0, selected: [] };
    if (memo.has(remaining)) return memo.get(remaining);
    if (memo.size > stateBudget) throw new Error(`Exact global assignment exceeded preregistered ${stateBudget}-state budget`);
    let active = [], pivot = 0n;
    for (const bit of bits.values()) if (remaining & bit) {
      const options = proposals.filter((proposal) => proposal.mask & bit && (proposal.mask & remaining) === proposal.mask);
      if (options.length > active.length) { active = options; pivot = bit; }
    }
    if (!pivot) return { utility: 0, selected: [] };
    let best = solve(remaining & ~pivot);
    for (const proposal of active) {
      const rest = solve(remaining & ~proposal.mask);
      const choice = {
        utility: rest.utility + proposal.utility,
        selected: [...rest.selected, proposal.index].sort((a, b) => a - b)
      };
      if (choice.utility > best.utility + 1e-12 ||
        Math.abs(choice.utility - best.utility) <= 1e-12 &&
        lexical(choice.selected.join(','), best.selected.join(',')) < 0) best = choice;
    }
    memo.set(remaining, best);
    return best;
  };
  const solution = solve(keys.reduce((mask, key) => mask | bits.get(key), 0n));
  return { fixes: solution.selected.map((index) => proposals[index].fix), states: memo.size, utility: solution.utility };
}
