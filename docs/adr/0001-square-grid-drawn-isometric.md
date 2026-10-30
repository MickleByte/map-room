# Square grid drawn as isometric diamonds, with optional east–west wrap

The map is stored as a plain square grid of `(x, y)` tiles. Every tile has 8 neighbours, and a diagonal step costs the same as a straight one. "Isometric diamond" is purely how the renderer projects the grid; game logic never sees screen geometry.

We picked this over true diamond-adjacency geometry because it keeps distances (Chebyshev), pathfinding and range checks trivial and testable. Rivers lie on grid edges. A diagonal attack counts as crossing a river if a river lies on either of the defender's two edges that touch the shared corner.

Each map has a `wrapX` flag. When it's on, x coordinates wrap, and every distance-based rule must go through the shared grid helpers: pathfinding, bombard range, operational range, sight, the camera and the minimap. No other code may do raw `x2 - x1` maths.
