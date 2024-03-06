import * as twgl from "twgl.js"
import GUI from "lil-gui";
import { Grid2D } from "./kommon/grid2D";
import { Input, KeyCode, Mouse, MouseButton } from "./kommon/input";
import { DefaultMap, deepcopy, findLast, fromCount, fromRange, objectMap, repeat, zip2 } from "./kommon/kommon";
import { mod, towards as approach, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo, shuffle, inRect } from "./kommon/math";
import { canvasFromAscii } from "./kommon/spritePS";
import { initGL2, IVec, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from "kanvas2d"

const input = new Input();
const canvas_ctx = document.querySelector<HTMLCanvasElement>("#ctx_canvas")!;
const ctx = canvas_ctx.getContext("2d")!;
const canvas_gl = document.querySelector<HTMLCanvasElement>("#gl_canvas")!;
const gl = initGL2(canvas_gl)!;
gl.clearColor(.5, .5, .5, 1);

const CONFIG = {
};

const gui = new GUI();

type Palo = 'P' | 'C' | 'T' | 'D';
const palos: Palo[] = ['P', 'C', 'T', 'D'];
const palo2hex: Record<Palo, string> = {
  P: "#FC4250",
  C: "#69D83A",
  T: "#F4D837",
  D: "#4CA4F2"
};

class AbstractPlato {
  constructor(
    public result_color: Palo,
    public slots: { color: Palo, scale: number }[],
  ) { }
}

class PlacedPlato {
  static size: Vec2 = new Vec2(180, 150);
  public insides: (PlacedPlato | null)[];
  constructor(
    public blueprint: AbstractPlato,
    public pos: Vec2,
  ) {
    this.insides = blueprint.slots.map(_ => null);
  }

  score(): number {
    let result = 1;
    for (const [placed, slot] of zip2(this.insides, this.blueprint.slots)) {
      if (placed !== null) {
        result += placed.score() * slot.scale;
      }
    }
    return result;
  }

  draw(background_color: string, highlighted_slot_index: { index: number, valid: boolean } | null): void {
    ctx.beginPath();
    ctx.fillStyle = background_color;
    rect(this.pos, PlacedPlato.size);
    ctx.fill();
    ctx.stroke();
    this.blueprint.slots.forEach((x, k) => {
      ctx.beginPath();
      rect(this.pos.add(new Vec2(10 + k * 60, 100)), Vec2.both(40));
      ctx.fillStyle = (highlighted_slot_index !== null && k === highlighted_slot_index.index) ? (highlighted_slot_index.valid ? "cyan" : "gray") : "white";
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = palo2hex[x.color];
      drawCircle(this.pos.add(new Vec2(30 + k * 60, 71)), 20);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "black";
      fillText(x.scale.toString(), this.pos.add(new Vec2(21 + k * 60, 82)));
      if (this.insides[k] !== null) {
        fillText(this.insides[k]!.score().toString().padStart(2), this.pos.add(new Vec2(12 + k * 60, 130)));
      }
    });
    ctx.beginPath();
    ctx.fillStyle = palo2hex[this.blueprint.result_color];
    rect(this.pos.add(new Vec2(10, 10)), new Vec2(160, 30));
    ctx.fill();

    ctx.textAlign = "center";
    ctx.beginPath();
    ctx.fillStyle = "black";
    fillText(this.score().toString(), this.pos.add(new Vec2(90, 37)));
    ctx.textAlign = "left";
  }
}

const base_recipes = palos.map(p => new AbstractPlato(p, []));
const complex_recipes = (() => {
  let cards = fromCount(12, k => ({ color: palos[k % 4], scale: 1 + Math.floor(k / 4) }));
  cards = shuffle(cards);
  let result: AbstractPlato[] = [];
  for (let k = 0; k < 4; k++) {
    result.push(new AbstractPlato(palos[k], [cards[3 * k], cards[3 * k + 1], cards[3 * k + 2]]));
  }
  return result;
})();

const recipes: AbstractPlato[] = [...base_recipes, ...complex_recipes];

var mazo: PlacedPlato[] = fromCount(52 - 12 - 12, k => new PlacedPlato(base_recipes[k % base_recipes.length], new Vec2(50 + k, 600 + k)));
mazo = shuffle(mazo);
mazo.forEach((c, k) => {
  c.pos = new Vec2(50 + k, 600 + k);
});
var placed_platos: PlacedPlato[] = complex_recipes.flatMap((x, i) => fromCount(3, j => new PlacedPlato(x, new Vec2(100 + i * (PlacedPlato.size.x + 20), 50 + j * (PlacedPlato.size.y + 20)))))
  .concat(mazo);

// var interaction_state: {tag: 'idle'}
//   | {tag: 'grabbing', carta: PlacedPlato} = {tag: 'idle'};
var interaction_state = { grabbed: null as PlacedPlato | null };

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
    let hovered: PlacedPlato | null = findLast(placed_platos, plato => inRect(raw_mouse_pos, plato.pos, PlacedPlato.size)) ?? null;
    if (hovered && input.mouse.wasPressed(MouseButton.Left)) {
      interaction_state.grabbed = hovered;
      // move to top of stack
      placed_platos = placed_platos.filter(x => x !== interaction_state.grabbed);
      placed_platos.push(interaction_state.grabbed);
    }
    ctx.strokeStyle = "black";
    placed_platos.forEach(x => {
      x.draw(x === hovered ? "orange" : "white", null);
    });
  } else {
    interaction_state.grabbed.pos = Vec2.lerp(interaction_state.grabbed.pos, raw_mouse_pos, .3);
    let hovered: PlacedPlato | null = findLast(placed_platos, plato => plato !== interaction_state.grabbed && inRect(raw_mouse_pos, plato.pos, PlacedPlato.size)) ?? null;
    let hovered_index: number | null = hovered?.blueprint.slots.findIndex((_, k) => {
      if (hovered === null) throw new Error();
      return hovered.insides[k] === null && inRect(raw_mouse_pos, hovered.pos.add(new Vec2(10 + k * 60, 100)), Vec2.both(40));
    }) ?? null;
    if (hovered_index === -1) hovered_index = null;
    let valid_index = (hovered !== null) && (hovered_index !== null) && (hovered.insides[hovered_index] === null) && (hovered.blueprint.slots[hovered_index].color === interaction_state.grabbed.blueprint.result_color);
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

  animation_id = requestAnimationFrame(every_frame);
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

function rect(top_left: Vec2, size: Vec2) {
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
