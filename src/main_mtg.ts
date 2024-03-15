import * as twgl from "twgl.js"
import GUI from "lil-gui";
import { Grid2D } from "./kommon/grid2D";
import { Input, KeyCode, Mouse, MouseButton } from "./kommon/input";
import { DefaultMap, deepcopy, findLast, fromCount, fromRange, objectMap, repeat, zip2 } from "./kommon/kommon";
import { mod, towards as approach, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo, shuffle, inRect } from "./kommon/math";
import { canvasFromAscii } from "./kommon/spritePS";
import { initGL2, IVec, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from "kanvas2d"
import peggy from "peggy";
import grammar from "./card_data.pegjs?raw";

type CardType = string;
type CardData = {
  name: string,
  types: CardType[],
  base_score: number,
  slots: {
    multiplier: number,
    accepted: CardType[],
  }[],
};

const parser = peggy.generate(grammar);
function parseCardData(input: string): CardData {
  return parser.parse(input);
}

const input = new Input();
const canvas_ctx = document.querySelector<HTMLCanvasElement>("#ctx_canvas")!;
const ctx = canvas_ctx.getContext("2d")!;
const canvas_gl = document.querySelector<HTMLCanvasElement>("#gl_canvas")!;
const gl = initGL2(canvas_gl)!;
gl.clearColor(.5, .5, .5, 1);

const CONFIG = {
  reset: reset,
};

const gui = new GUI();
gui.add(CONFIG, "reset");

const cards_data: CardData[] = `
lenteja {legumbre}: 1
garbanzo {legumbre}: 2
judia_verde {verdura}: 2
alcachofa {verdura}: 3
paella {segundo}: 3 + 2 * {caldo} + 0 * {arroz} + 1 * {carne, pescado, verduras}
cocido {segundo}: 3 + 2 * {caldo} + 0 * {fideo} + 1 * {carne, pescado, verduras}
caldo_de_bote {caldo, primero}: 1
caldo {caldo, primero}: 3 + 0 * {carne, pescado, verduras}
filete {carne}: 5
pollo {carne}: 3
carne_mala {carne}: 1
sofrito {verdura, salsa}: 2 + 1 * {verduras}
picklear {primero, verduras}: 2 + 1 * {verduras}
mostazar {primero, carne}: 2 + 1 * {carne}
croquetas {primero}: 5 + 1 * {segundo}
salsa_de_bote {salsa}: 1
salsa {salsa}: 2 + 1 * {verduras}
macarron {pasta}: 1
tortellini {pasta}: 3 + 0 * {carne, verduras}
pasta {segundo}: 1 + 1 * {pasta} + 1 * {salsa}
`.trim().split('\n').map(parseCardData);

function colorFromType(x: CardType): string {
  return "#ff0000";
}

class PlacedPlato {
  public size: Vec2 = new Vec2(180, 150);
  public insides: (PlacedPlato | null)[];
  constructor(
    public data: CardData,
    public pos: Vec2,
  ) {
    this.insides = data.slots.map(_ => null);
  }

  score(): { score: number, is_valid: boolean } {
    let score = this.data.base_score;
    let is_valid = true;
    for (const [placed, slot] of zip2(this.insides, this.data.slots)) {
      if (placed !== null) {
        score += placed.score().score * slot.multiplier;
        is_valid = is_valid && placed.score().is_valid;
      } else {
        is_valid = false;
      }
    }
    return { score, is_valid };
  }

  slotIndexAt(world_pos: Vec2): number | null {
    // return this.insides.findIndex((content, k) => {
    //   return content !== null && inRect(raw_mouse_pos, hovered.pos.add(new Vec2(10 + k * 60, 100)), Vec2.both(40));
    // }) ?? null;
    return null;
  }

  draw(background_color: string, highlighted_slot_index: { index: number, valid: boolean } | null): void {
    ctx.beginPath();
    ctx.fillStyle = background_color;
    drawRect(this.pos, this.size);
    ctx.fill();
    ctx.stroke();
    this.data.slots.forEach((x, k) => {
      ctx.beginPath();
      drawRect(this.pos.add(new Vec2(10 + k * 60, 100)), Vec2.both(40));
      ctx.fillStyle = (highlighted_slot_index !== null && k === highlighted_slot_index.index) ? (highlighted_slot_index.valid ? "cyan" : "gray") : "white";
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      // TODO: draw all accepted colors
      ctx.fillStyle = colorFromType(x.accepted[0]);
      drawCircle(this.pos.add(new Vec2(30 + k * 60, 71)), 20);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "black";
      fillText(x.multiplier.toString(), this.pos.add(new Vec2(21 + k * 60, 82)));
      if (this.insides[k] !== null) {
        fillText(this.insides[k]!.score().score.toString().padStart(2), this.pos.add(new Vec2(12 + k * 60, 130)));
      }
    });
    ctx.beginPath();
    // TODO: draw all result colors
    ctx.fillStyle = colorFromType(this.data.types[0]);
    drawRect(this.pos.add(new Vec2(10, 10)), new Vec2(160, 30));
    ctx.fill();

    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.fillStyle = "black";
    fillText(this.score().score.toString(), this.pos.add(new Vec2(20, 37)));
    ctx.textAlign = "left";
  }
}

let placed_platos: PlacedPlato[];

let interaction_state = { grabbed: null as PlacedPlato | null };

function reset() {
  placed_platos = fromCount(52, k => new PlacedPlato(randomChoice(cards_data), new Vec2(50 + k, 600 + k)));
}

reset();

function button(text: string, top_left: Vec2, size: Vec2, mouse_pos: Vec2, mouse_was_clicked: boolean): boolean {
  const mouse_inside = inRect(mouse_pos, top_left, size);
  ctx.fillStyle = mouse_inside ? "orange" : "#BBB";
  ctx.beginPath();
  drawRect(top_left, size);
  ctx.fill();
  ctx.fillStyle = "black";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fillText(text, top_left.add(size.scale(.5)));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return mouse_inside && mouse_was_clicked;
}

let last_timestamp = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp: number) {
  // in seconds
  let delta_time = (cur_timestamp - last_timestamp) / 1000;
  last_timestamp = cur_timestamp;
  input.startFrame();
  ctx.resetTransform();
  ctx.clearRect(0, 0, canvas_ctx.width, canvas_ctx.height);
  ctx.fillStyle = 'gray';
  ctx.fillRect(0, 0, canvas_ctx.width, canvas_ctx.height);
  if (or(twgl.resizeCanvasToDisplaySize(canvas_ctx), twgl.resizeCanvasToDisplaySize(canvas_gl))) {
    // resizing stuff
    gl.viewport(0, 0, canvas_gl.width, canvas_gl.height);
  }
  ctx.font = '32px Arial';

  const canvas_rect = canvas_ctx.getBoundingClientRect();
  const raw_mouse_pos = new Vec2(input.mouse.clientX - canvas_rect.left, input.mouse.clientY - canvas_rect.top);

  if (interaction_state.grabbed === null) {
    let hovered: PlacedPlato | null = findLast(placed_platos, plato => inRect(raw_mouse_pos, plato.pos, plato.size)) ?? null;
    if (hovered && input.mouse.wasPressed(MouseButton.Left)) {
      let hovered_index: number | null = hovered.slotIndexAt(raw_mouse_pos);
      if (hovered_index !== null && hovered.insides[hovered_index] !== null) {
        // extract card
        interaction_state.grabbed = hovered.insides[hovered_index]!;
        interaction_state.grabbed.pos = raw_mouse_pos;
        placed_platos.push(interaction_state.grabbed);
        hovered.insides[hovered_index] = null;
      } else {
        // grab card
        interaction_state.grabbed = hovered;
        toTop(interaction_state.grabbed);
      }
    } else if (hovered && input.mouse.wasPressed(MouseButton.Right)) {
      hovered.pos = new Vec2(1300, 100).add(Vec2.fromTurns(Math.random()).scale(20));
      toTop(hovered);
    }
    ctx.strokeStyle = "black";
    placed_platos.forEach(x => {
      x.draw(x === hovered ? "orange" : "white", null);
    });
  } else {
    interaction_state.grabbed.pos = Vec2.lerp(interaction_state.grabbed.pos, raw_mouse_pos, .3);
    let hovered: PlacedPlato | null = findLast(placed_platos, plato => plato !== interaction_state.grabbed && inRect(raw_mouse_pos, plato.pos, plato.size)) ?? null;
    let hovered_index: number | null = hovered?.slotIndexAt(raw_mouse_pos) ?? null;
    let valid_index = (hovered !== null) && (hovered_index !== null) && (hovered.insides[hovered_index] === null) && (hovered.data.slots[hovered_index].accepted.some(x => interaction_state.grabbed!.data.types.includes(x)));
    if (!input.mouse.isDown(MouseButton.Left)) {
      if (hovered !== null && hovered_index !== null && valid_index) {
        hovered.insides[hovered_index] = interaction_state.grabbed;
        placed_platos = placed_platos.filter(x => x !== interaction_state.grabbed);
      }
      interaction_state.grabbed = null;
    }
    ctx.strokeStyle = "black";
    placed_platos.forEach(x => {
      x.draw(x === interaction_state.grabbed ? "yellow" : "white", (hovered === x && hovered_index !== null) ? { index: hovered_index, valid: valid_index } : null);
    });
  }

  const mazo_bounds = new Transform(new Vec2(25, 575), new Vec2(150, 250), Vec2.zero, 0);
  ctx.strokeStyle = "white";
  ctx.beginPath();
  drawRect(mazo_bounds.position, mazo_bounds.size);
  ctx.stroke();

  if (interaction_state.grabbed === null) {
    if (button("draw", new Vec2(100, 800), new Vec2(100, 50), raw_mouse_pos, input.mouse.wasPressed(MouseButton.Left))) {
      let next_card = findLast(placed_platos, v => inRect(v.pos, mazo_bounds.position, mazo_bounds.size));
      if (next_card !== undefined) {
        let new_pos = next_card.pos.addX(275);
        while (placed_platos.some(x => new_pos.sub(x.pos).mag() < 100)) {
          new_pos = new_pos.addX(200);
        }
        // anims.push(dt => {
        //   return false;
        // });
        next_card.pos = new_pos;
        toTop(next_card);
      }
    }
  }

  animation_id = requestAnimationFrame(every_frame);
}

// type AnimCallback = (dt: number) => boolean;
// let anims: AnimCallback[] = [];


function toTop(plato: PlacedPlato): void {
  // move to top of stack
  placed_platos = placed_platos.filter(x => x !== plato);
  placed_platos.push(plato);
}

////// library stuff

function single<T>(arr: T[]) {
  if (arr.length === 0) {
    throw new Error("the array was empty");
  } else if (arr.length > 1) {
    throw new Error(`the array had more than 1 element: ${arr}`);
  } else {
    return arr[0];
  }
}

function at<T>(arr: T[], index: number): T {
  if (arr.length === 0) throw new Error("can't call 'at' with empty array");
  return arr[mod(index, arr.length)];
}

function drawCircle(center: Vec2, radius: number) {
  ctx.moveTo(center.x + radius, center.y);
  ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
}

function drawRect(top_left: Vec2, size: Vec2) {
  ctx.rect(top_left.x, top_left.y, size.x, size.y);
}

function moveTo(pos: Vec2) {
  ctx.moveTo(pos.x, pos.y);
}

function lineTo(pos: Vec2) {
  ctx.lineTo(pos.x, pos.y);
}

function fillText(text: string, pos: Vec2) {
  ctx.fillText(text, pos.x, pos.y);
}

function or(a: boolean, b: boolean) {
  return a || b;
}

if (import.meta.hot) {
  if (import.meta.hot.data.edges) {
    // items = import.meta.hot.data.items;
  }

  // import.meta.hot.accept();

  import.meta.hot.dispose((data) => {
    input.mouse.dispose();
    input.keyboard.dispose();
    cancelAnimationFrame(animation_id);
    gui.destroy();
    // data.items = items;
  })
}

let animation_id: number;
const loading_screen_element = document.querySelector<HTMLDivElement>("#loading_screen")!;
if (loading_screen_element) {
  loading_screen_element.innerText = "Press to start!";
  document.addEventListener("pointerdown", _event => {
    loading_screen_element.style.opacity = "0";
    animation_id = requestAnimationFrame(every_frame);
  }, { once: true });
} else {
  animation_id = requestAnimationFrame(every_frame);
}
