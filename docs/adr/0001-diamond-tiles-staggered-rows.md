# Diamond tiles in staggered rows, with optional left–right wrap

The map is made of diamond tiles laid out in staggered rows, with odd rows offset by half a tile. The map is therefore a rectangle on screen and can wrap left–right, as in Civilization III. Every tile has 8 neighbours. Four share an edge (NE, SE, SW, NW) and four share only a corner (N, E, S, W), and all 8 cost one step. Topologically this is a square grid rotated 45°.

Tiles are stored as `(x = column, y = row)`. Geometry is calculated in "doubled" columns (`d = 2x + (y & 1)`), where the neighbour offsets are fixed and distance is simply `(|Δd| + |Δy|) / 2`. This keeps pathfinding, range and wrap maths trivial.

Rivers lie on tile edges. Each tile stores its own SE and SW edges, and reads its NE and NW edges from its neighbours. An edge move crosses a river if there is a river on the shared edge. A corner move crosses a river if a river lies on either of the defender's two edges that meet at that corner.

Each map has a `wrapX` flag. Every distance-based rule must go through the helpers in `core/grid.ts`: pathfinding, bombard range, operational range, sight, the camera and the minimap. No other code may do raw coordinate subtraction.

## Considered options

- **Plain square-grid coordinates drawn as one big diamond.** This was rejected because x-wrapping would make the map wrap diagonally on screen, not left–right. (It was the first version of this ADR, amended before any rendering existed.)
