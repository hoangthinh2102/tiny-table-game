# Tiny Tumble

Online co-op party game in a warm, handmade miniature world. Players come in duos. Each duo starts on a corner of a
giant desk and crosses the furniture to the board game in the middle. Duos score by knocking each other off.

## Play

```
npm install
npm start                # http://localhost:8080
```

Environment (try `MATCH_T=60` for quick tests):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8080 | HTTP + WebSocket port |
| `ROOM_SIZE` | 8 | players per match (duos = ROOM_SIZE / 2); bots fill empty seats |
| `LOBBY_WAIT` | 12 | seconds before a room starts with bots |
| `MATCH_T` | 360 | seconds per match |
| `SCORE_WIN` | 15 | points that end the match early |

The home screen offers quick play (a public room that starts after a short countdown) and private rooms. A
private room gets a 4-letter code and an invite link (`?room=CODE`). Players are paired into duos in join order, the
host (★) starts the match, and bots fill the empty seats. Leaving a match (❚❚ or Esc, then **Thoát trận**) hands
your doll to a bot.

Controls: WASD to move, Space to jump, the mouse to aim and fire, F (or E) to use. Hold Q (or Tab) to see the whole
desk with everyone marked on it, or press and drag on the minimap to look somewhere else; the camera comes back when
you let go. Phones get two sticks plus **Nhảy**, **Dùng** and **Xem** (toggles the whole-desk view) buttons.

**Boosting:** one partner braces by holding F, and a green ring appears around them. Jump from inside the ring to
fly up and far, the way you are running, or the way you aim if you stand still. You keep your speed in the air until
you steer.

## Rules

### The route

The route is built anew for each match from modules. Every duo gets the same route, turned a quarter for its own
corner. There are two legs of four modules, and each leg alternates one module you can do alone with one that needs
both partners.

| Module | Needs two | How it works |
| --- | --- | --- |
| Khối gỗ | no | Jump between stepping blocks. |
| Bút chì quay | no | A pencil spins on a pin; jump over it. |
| Nắp lọ | no | Jam-jar lids ferry you over the drop; step on when one docks. |
| Ngăn kéo | no | A drawer slides out and back in; run across while it is out. |
| Quạt thổi | no | Walk off the edge into the fan's updraft and float across. |
| Tàu đồ chơi | no | Toy trains run across the plank; time your crossing. |
| Cổng nút nhấn | yes | A pencil gate is open only while someone stands on one of its two buttons. |
| Khe bật cao | yes | The gap is too wide to jump. One partner braces by holding F, the other jumps from the green ring around them for a boost, then pulls a lever that lowers a ruler bridge for 25 s. |
| Bập bênh | yes | One partner stands on the green end, the other jumps onto the orange end to fling them across. A button on the far side holds a bridge for the one left behind. |
| Hai cần gạt | yes | Two levers far apart must be pulled within 1.2 s of each other to lower a bridge for 20 s. |

Falling off the route costs 20 HP and puts you back at the last checkpoint.

### The arena

All routes end on a wooden ring around the board game, where duos from neighbouring corners meet. The ring has
chests. There are three ways onto the board:

- a narrow ruler bridge in the middle of each side;
- a boost across the gap;
- a seesaw in each ring corner that flings you straight onto a tower.

The board:

- **Hazards:** it has holes. Tiles shake for 3 s, then drop for 18 s every 70 s. A giant marble rolls across a lane
  every 50 s, and the lane glows red first. **Falling off the board knocks you out.**
- **Towers:** four book towers stand on the board. Only a boost or a seesaw gets you up. A golden chest sits on top
  of each one, and the top is a good place to shoot from.
- **Giant slingshots:** one partner stands in the pouch, and the other holds F at the handle and aims. The flier lands
  with a shockwave that throws enemies back.
- **Scoring:** when an enemy falls off anything (the board, the ring, a tower, or their route) within 5 s of being
  hit by your duo, your duo scores a point. Falls nobody caused score nothing.
- **Knockback:** every hit pushes, and the more hurt you are, the further you fly: up to 2.5 times at 0 HP, and
  2.2 times while downed. Badly hurt players blink red.
- **Winning:** after 6 minutes the duo with the most points wins, unless someone reaches 15 first.

### Getting hurt

- At 0 HP you go down, and your partner revives you by standing close. If nobody does, you come back after 6 s next
  to your partner.
- If both partners are out, the duo restarts at its start box and runs the course again.

### Loot

Chests hold toy weapons, plasters (+40 HP) and bottle caps (+50 armour). Everyone keeps a slingshot. The weapons push
more than they hurt, because pushing people off the board is the best way to beat them.

| Weapon | Notes |
| --- | --- |
| Súng sáp màu | fast, light |
| Súng dây chun | 6-band spread, short range |
| Súng hơi bóng bay | 5-puff cone, almost no damage, big push |
| Búa đồ chơi | melee sweep, big push |
| Súng ghim | slow, heavy, long range (golden chests) |
| Bom bi ve | lobbed over cover, blast with a big push (golden chests) |

## Code

- `shared/sim.js`: the simulation, shared by server and client.
  - Route modules (`MODS`) are laid out in their own coordinates (u forward, v sideways). `SIM.course(seed)` picks
    and orders them, and `makeMap` places them along two legs and turns the route four times around the centre.
  - The board is a 10 x 10 grid of tiles with holes. Towers are surfaces with a height (`z`).
  - Everything that moves by the clock is a function of the time and the seed, so the client draws and predicts it
    without being told: lids, drawers, trains, pencils, the marble and crumbling tiles.
  - `SIM.move` (walking, jumping, boosts, fans, towers, riding lids, falling) also runs on the client for the local
    player.
- `server.js`: static files, rooms and the 30 Hz authoritative loop. Snapshots go out at 15 Hz, plus every tick
  that has events.
- `bots.js`: one script per module, run in that module's coordinates.
  - With a human partner, the bot takes the waiting role (holding the button, being the boost base, standing on the
    seesaw, taking the far lever).
  - In the arena, bots cross their bridge and hunt: they get on the far side of an enemy from its nearest drop and
    shoot it that way. They also open chests, boost each other up towers for the golden chests, and dodge the marble
    and crumbling tiles.
- Deploy: matches live in the server's memory, so run exactly one instance. `/healthz` answers `ok`.
  - Render (free, Singapore): `render.yaml` is a blueprint. Connect the Git repo in the Render dashboard (New →
    Blueprint). A free service sleeps after 15 minutes without traffic, and the first visit after that waits about a
    minute.
  - Fly.io: `Dockerfile` and `fly.toml`, then `fly deploy --ha=false`.
- `client/`: the view is three.js 0.169 by default, with PixiJS 8 as the fallback. Add `?2d` to the URL for the PixiJS
  view; the game also switches to it on its own when there is no WebGL or three.js does not load.
  - `js/render3d.js` is the 3D view:
    - sim (x, y, z) is three.js (x, z, y);
    - static furniture is merged into one mesh per material, and the board is instanced tiles;
    - moving parts are posed from the sim at the predicted time;
    - name tags and bars are HTML placed over the 3D scene;
    - quality drops on its own when frames run slow.
  - `js/render3d_doll.js` builds the dolls, toy weapons and pickups from primitives.
  - `js/art.js` holds the procedural 2D art, which the 3D view also uses for some textures.
  - `js/game.js` handles networking, prediction and reconciliation, interpolation, the 2D scene, the camera
    (overview, minimap peek), the HUD and the hints. Hooks into the 3D view are marked `[3D]`.
- `concept/`: mood images for the art pass.
